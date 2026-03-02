--- TỔNG HỢP SQL PINELAB ERP & ORGANIC LOG ---
--- 1. Khởi tạo Cơ sở hạ tầng (Tables) ---
-- Kích hoạt extension UUID nếu chưa có
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Danh mục sản phẩm & nguyên liệu
CREATE TABLE IF NOT EXISTS items (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    code text UNIQUE NOT NULL,
    name text NOT NULL,
    type text CHECK (type IN ('finished_good', 'raw_material')),
    unit text,
    organic_cert_no TEXT, -- Cột phục vụ Organic
    is_organic_approved BOOLEAN DEFAULT FALSE, -- Cột phục vụ Organic
    created_at timestamptz DEFAULT now()
);

-- Quản lý Kho (WMS)
CREATE TABLE IF NOT EXISTS inventory (
    item_id uuid PRIMARY KEY REFERENCES items(id),
    quantity_on_hand numeric DEFAULT 0,
    quantity_reserved numeric DEFAULT 0,
    quantity_available numeric GENERATED ALWAYS AS (quantity_on_hand - quantity_reserved) STORED
);

-- Công thức sản xuất (BOM)
CREATE TABLE IF NOT EXISTS bom (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    parent_item_id uuid REFERENCES items(id),
    component_item_id uuid REFERENCES items(id),
    quantity_required numeric NOT NULL,
    unit text DEFAULT 'pcs',
    UNIQUE(parent_item_id, component_item_id)
);

-- Quản lý Đơn hàng (OMS)
CREATE TABLE IF NOT EXISTS orders (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    customer_name text,
    status text DEFAULT 'pending',
    created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS order_items (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    order_id uuid REFERENCES orders(id) ON DELETE CASCADE,
    item_id uuid REFERENCES items(id),
    quantity numeric NOT NULL,
    price numeric
);

-- Nhật ký canh tác & Lô đất (Farming)
CREATE TABLE IF NOT EXISTS plots (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    name text NOT NULL,
    area numeric,
    crop_type text,
    status text DEFAULT 'active'
);

CREATE TABLE IF NOT EXISTS farming_logs (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    plot_id uuid REFERENCES plots(id),
    activity_date date DEFAULT CURRENT_DATE,
    activity_type text CHECK (activity_type IN ('Sowing', 'Fertilizing', 'Pest_Control', 'Harvesting', 'Watering')),
    description text,
    input_item_id uuid REFERENCES items(id),
    input_quantity numeric,
    worker_name text,
    organic_status text DEFAULT 'compliant',
    evidence_url TEXT, -- Link ảnh bằng chứng
    created_at timestamptz DEFAULT now()
);

-- Bảng phụ trợ: Nhập kho & Hồ sơ lô
CREATE TABLE IF NOT EXISTS stock_in (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    item_id uuid REFERENCES items(id),
    quantity numeric NOT NULL,
    supplier_name text,
    created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS batch_records (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    batch_number TEXT UNIQUE NOT NULL,
    order_id UUID REFERENCES orders(id),
    product_id UUID REFERENCES items(id),
    quantity_produced INTEGER,
    qc_status TEXT DEFAULT 'pending',
    qc_staff TEXT,
    bom_snapshot JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
--- 2. Logic Tự động hóa (Triggers & Functions) ---
-- Trigger 1: Tự tạo dòng kho khi thêm sản phẩm mới
CREATE OR REPLACE FUNCTION handle_new_item_inventory() RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO inventory (item_id) VALUES (NEW.id) ON CONFLICT DO NOTHING;
    RETURN NEW;
END; $$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER tr_init_inventory_after_insert
AFTER INSERT ON items FOR EACH ROW EXECUTE FUNCTION handle_new_item_inventory();

-- Trigger 2: Tự cộng kho khi có phiếu nhập hàng
CREATE OR REPLACE FUNCTION handle_stock_in() RETURNS TRIGGER AS $$
BEGIN
    UPDATE inventory 
    SET quantity_on_hand = quantity_on_hand + NEW.quantity 
    WHERE item_id = NEW.item_id;
    RETURN NEW;
END; $$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER tr_update_stock_after_in
AFTER INSERT ON stock_in FOR EACH ROW EXECUTE FUNCTION handle_stock_in();

-- Trigger 3: Tự trừ kho vật tư khi ghi Nhật ký canh tác (Organic Control)
CREATE OR REPLACE FUNCTION handle_farming_input_deduction() RETURNS TRIGGER AS $$
BEGIN
    IF NEW.input_item_id IS NOT NULL AND NEW.input_quantity > 0 THEN
        IF (SELECT quantity_on_hand FROM inventory WHERE item_id = NEW.input_item_id) < NEW.input_quantity THEN
            RAISE EXCEPTION 'Kho không đủ vật tư % để thực hiện canh tác!', (SELECT name FROM items WHERE id = NEW.input_item_id);
        END IF;
        UPDATE inventory SET quantity_on_hand = quantity_on_hand - NEW.input_quantity WHERE item_id = NEW.input_item_id;
    END IF;
    RETURN NEW;
END; $$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER tr_deduct_inventory_on_farming_log
AFTER INSERT ON farming_logs FOR EACH ROW EXECUTE FUNCTION handle_farming_input_deduction();
--- 3. Các hàm nghiệp vụ nhanh (RPC) ---
-- Đặt hàng & Giữ hàng
CREATE OR REPLACE FUNCTION place_order_and_reserve(p_item_id uuid, p_qty numeric) RETURNS void AS $$
BEGIN
    IF (SELECT quantity_available FROM inventory WHERE item_id = p_item_id) >= p_qty THEN
        UPDATE inventory SET quantity_reserved = quantity_reserved + p_qty WHERE item_id = p_item_id;
    ELSE
        RAISE EXCEPTION 'Kho không đủ hàng!';
    END IF;
END; $$ LANGUAGE plpgsql;

-- Nhập kho nhanh bằng SKU
CREATE OR REPLACE FUNCTION quick_stock_in(p_sku text, p_qty numeric, p_supplier text DEFAULT 'N/A') RETURNS void AS $$
DECLARE v_item_id uuid;
BEGIN
    SELECT id INTO v_item_id FROM items WHERE code = p_sku;
    IF v_item_id IS NULL THEN RAISE EXCEPTION 'Mã SKU (%) không tồn tại!', p_sku; END IF;
    INSERT INTO stock_in (item_id, quantity, supplier_name) VALUES (v_item_id, p_qty, p_supplier);
END; $$ LANGUAGE plpgsql;

-- Hoàn tất sản xuất (Trừ NL theo BOM, Cộng TP)
CREATE OR REPLACE FUNCTION mes_complete_production(p_product_id uuid, p_produce_qty numeric) RETURNS void AS $$
DECLARE row_bom RECORD;
BEGIN
    FOR row_bom IN SELECT component_item_id, quantity_required FROM bom WHERE parent_item_id = p_product_id LOOP
        UPDATE inventory SET quantity_on_hand = quantity_on_hand - (row_bom.quantity_required * p_produce_qty) WHERE item_id = row_bom.component_item_id;
    END LOOP;
    UPDATE inventory SET quantity_on_hand = quantity_on_hand + p_produce_qty WHERE item_id = p_product_id;
END; $$ LANGUAGE plpgsql;
--- 4. Hệ thống báo cáo (Views) ---
-- Báo cáo Tồn kho
CREATE OR REPLACE VIEW v_inventory_report AS
SELECT t.code AS sku, t.name AS product_name, t.type AS item_type, t.unit,
       i.quantity_on_hand AS total_stock, i.quantity_reserved AS reserved_stock, i.quantity_available AS available_stock,
       CASE WHEN i.quantity_available <= 0 THEN 'Hết hàng' WHEN i.quantity_available < 10 THEN 'Sắp hết' ELSE 'Sẵn có' END AS stock_status
FROM items t JOIN inventory i ON t.id = i.item_id;

-- Báo cáo Truy xuất nguồn gốc Organic (Quan trọng nhất để đánh giá)
CREATE OR REPLACE VIEW v_organic_traceability_report AS
SELECT f.activity_date AS "Ngày", p.name AS "Lô đất", f.activity_type AS "Hoạt động",
       i.name AS "Vật tư sử dụng", i.organic_cert_no AS "Số chứng chỉ",
       f.input_quantity AS "Lượng dùng", f.evidence_url AS "Ảnh bằng chứng", f.worker_name AS "Người thực hiện"
FROM farming_logs f
JOIN plots p ON f.plot_id = p.id
LEFT JOIN items i ON f.input_item_id = i.id;
--- 5. Phân quyền & Bảo mật (RLS) ---
-- Bật RLS cho tất cả các bảng
DO $$ 
DECLARE t text;
BEGIN 
    FOR t IN (SELECT tablename FROM pg_tables WHERE schemaname = 'public') LOOP
        EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
        EXECUTE format('DROP POLICY IF EXISTS "Allow all access" ON %I', t);
        EXECUTE format('CREATE POLICY "Allow all access" ON %I FOR ALL USING (true) WITH CHECK (true)', t);
    END LOOP;
END $$;

-- Cho phép mọi người xem ảnh (Public Read)
CREATE POLICY "Public Access" ON storage.objects FOR SELECT USING (bucket_id = 'farming-evidences');

-- Cho phép Upload ảnh (Public Insert)
CREATE POLICY "Allow Upload" ON storage.objects FOR INSERT WITH CHECK (bucket_id = 'farming-evidences');
