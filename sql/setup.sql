-- 1. Danh mục sản phẩm & nguyên liệu
CREATE TABLE IF NOT EXISTS items (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  code text UNIQUE NOT NULL,
  name text NOT NULL,
  type text CHECK (type IN ('finished_good', 'raw_material')),
  unit text,
  created_at timestamptz DEFAULT now()
);

-- 2. Định mức nguyên vật liệu (BOM)
CREATE TABLE IF NOT EXISTS bom (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  parent_item_id uuid REFERENCES items(id),
  component_item_id uuid REFERENCES items(id),
  quantity_required numeric NOT NULL,
  UNIQUE(parent_item_id, component_item_id)
);

-- 3. Quản lý Kho (WMS)
CREATE TABLE IF NOT EXISTS inventory (
  item_id uuid PRIMARY KEY REFERENCES items(id),
  quantity_on_hand numeric DEFAULT 0,
  quantity_reserved numeric DEFAULT 0,
  quantity_available numeric GENERATED ALWAYS AS (quantity_on_hand - quantity_reserved) STORED
);

-- 4. Nhật ký nhập hàng (Inbound)
CREATE TABLE IF NOT EXISTS stock_in (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  item_id uuid REFERENCES items(id),
  quantity numeric NOT NULL,
  supplier_name text,
  created_at timestamptz DEFAULT now()
);

-- 5. Quản lý Đơn hàng (OMS)
CREATE TABLE IF NOT EXISTS orders (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  customer_name text,
  status text DEFAULT 'pending', -- pending, shipping, completed, cancelled
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS order_items (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  order_id uuid REFERENCES orders(id) ON DELETE CASCADE,
  item_id uuid REFERENCES items(id),
  quantity numeric NOT NULL,
  price numeric
);

-- Chức năng: Tự động khởi tạo dòng trong kho khi có sản phẩm mới
CREATE OR REPLACE FUNCTION handle_new_item_inventory()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO inventory (item_id, quantity_on_hand, quantity_reserved)
  VALUES (NEW.id, 0, 0) ON CONFLICT (item_id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER tr_init_inventory_after_insert
AFTER INSERT ON items FOR EACH ROW EXECUTE FUNCTION handle_new_item_inventory();

-- Chức năng: Tự động giữ hàng (Reserve) khi khách đặt hàng
CREATE OR REPLACE FUNCTION handle_new_order_item()
RETURNS TRIGGER AS $$
BEGIN
  PERFORM place_order_and_reserve(NEW.item_id, NEW.quantity);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER tr_reserve_stock_on_order
AFTER INSERT ON order_items FOR EACH ROW EXECUTE FUNCTION handle_new_order_item();

-- Chức năng: Tự động cộng kho khi có phiếu nhập hàng (Stock-in)
CREATE OR REPLACE FUNCTION handle_stock_in()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE inventory SET quantity_on_hand = quantity_on_hand + NEW.quantity WHERE item_id = NEW.item_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Bước 1: Xóa để làm mới (Reset Trigger & Function)
DROP TRIGGER IF EXISTS tr_update_stock_after_in ON stock_in;
DROP FUNCTION IF EXISTS handle_stock_in();

-- Bước 2: Tạo hàm xử lý logic cộng kho
CREATE OR REPLACE FUNCTION handle_stock_in()
RETURNS TRIGGER AS $$
BEGIN
  -- Logic: Nếu item chưa có trong kho thì chèn mới, nếu có rồi thì cộng dồn
  INSERT INTO inventory (item_id, quantity_on_hand, quantity_reserved)
  VALUES (NEW.item_id, NEW.quantity, 0)
  ON CONFLICT (item_id) 
  DO UPDATE SET quantity_on_hand = inventory.quantity_on_hand + EXCLUDED.quantity_on_hand;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Bước 3: Tạo Trigger (Lưu ý: Không dùng OR REPLACE ở đây)
CREATE TRIGGER tr_update_stock_after_in
AFTER INSERT ON stock_in
FOR EACH ROW
EXECUTE FUNCTION handle_stock_in();

-- Bước 4: Hàm nhập kho nhanh (Đã tối ưu để gọi bảng stock_in)
CREATE OR REPLACE FUNCTION quick_stock_in(p_sku text, p_qty numeric, p_supplier text DEFAULT 'N/A')
RETURNS void AS $$
DECLARE
    v_item_id uuid;
BEGIN
    SELECT id INTO v_item_id FROM items WHERE code = p_sku;

    IF v_item_id IS NULL THEN
        RAISE EXCEPTION 'Mã SKU (%) không tồn tại!', p_sku;
    END IF;

    -- Lệnh này sẽ kích hoạt Trigger ở Bước 3
    INSERT INTO stock_in (item_id, quantity, supplier_name)
    VALUES (v_item_id, p_qty, p_supplier);
END;
$$ LANGUAGE plpgsql;

-- Chức năng: Kiểm tra tồn kho khả dụng và giữ hàng
CREATE OR REPLACE FUNCTION place_order_and_reserve(p_item_id uuid, p_qty numeric)
RETURNS void AS $$
BEGIN
  IF (SELECT quantity_available FROM inventory WHERE item_id = p_item_id) >= p_qty THEN
    UPDATE inventory SET quantity_reserved = quantity_reserved + p_qty WHERE item_id = p_item_id;
  ELSE
    RAISE EXCEPTION 'Kho không đủ hàng cho mã sản phẩm này!';
  END IF;
END;
$$ LANGUAGE plpgsql;

-- Chức năng: Sản xuất thành phẩm (Tự trừ nguyên liệu theo BOM, cộng thành phẩm)
CREATE OR REPLACE FUNCTION mes_complete_production(p_product_id uuid, p_produce_qty numeric)
RETURNS void AS $$
DECLARE row_bom RECORD;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM bom WHERE parent_item_id = p_product_id) THEN
        RAISE EXCEPTION 'Sản phẩm này chưa được thiết lập công thức sản xuất (BOM)!';
    END IF;
    FOR row_bom IN SELECT component_item_id, quantity_required FROM bom WHERE parent_item_id = p_product_id LOOP
        UPDATE inventory SET quantity_on_hand = quantity_on_hand - (row_bom.quantity_required * p_produce_qty) WHERE item_id = row_bom.component_item_id;
    END LOOP;
    UPDATE inventory SET quantity_on_hand = quantity_on_hand + p_produce_qty WHERE item_id = p_product_id;
END;
$$ LANGUAGE plpgsql;
-- Chức năng: nhập nhanh SKU để nhập kho
CREATE OR REPLACE FUNCTION quick_stock_in(p_sku text, p_qty numeric, p_supplier text DEFAULT 'N/A')
RETURNS void AS $$
DECLARE
    v_item_id uuid;
BEGIN
    -- 1. Tìm ID sản phẩm dựa trên mã SKU (code)
    SELECT id INTO v_item_id FROM items WHERE code = p_sku;

    -- 2. Nếu không tìm thấy mã SKU thì báo lỗi
    IF v_item_id IS NULL THEN
        RAISE EXCEPTION 'Mã SKU (%) không tồn tại trong danh mục!', p_sku;
    END IF;

    -- 3. Ghi nhận vào nhật ký nhập hàng (Bảng stock_in)
    -- Trigger tr_update_stock_after_in bạn tạo trước đó sẽ tự động cộng kho cho bạn
    INSERT INTO stock_in (item_id, quantity, supplier_name)
    VALUES (v_item_id, p_qty, p_supplier);

    RAISE NOTICE 'Đã nhập thành công % đơn vị cho mã %', p_qty, p_sku;
END;
$$ LANGUAGE plpgsql;

-- Chức năng: Xác nhận xuất kho (Trừ thực tế, giải phóng lượng giữ hàng)
CREATE OR REPLACE FUNCTION confirm_order_shipping(p_order_id uuid)
RETURNS void AS $$
DECLARE row_item RECORD;
BEGIN
    FOR row_item IN SELECT item_id, quantity FROM order_items WHERE order_id = p_order_id LOOP
        UPDATE inventory SET quantity_on_hand = quantity_on_hand - row_item.quantity, quantity_reserved = quantity_reserved - row_item.quantity WHERE item_id = row_item.item_id;
    END LOOP;
    UPDATE orders SET status = 'shipping' WHERE id = p_order_id;
END;
$$ LANGUAGE plpgsql;

-- Chức năng: Hủy đơn hàng (Trả lại lượng giữ hàng cho kho)
CREATE OR REPLACE FUNCTION cancel_order(p_order_id uuid)
RETURNS void AS $$
DECLARE row_item RECORD;
BEGIN
    FOR row_item IN SELECT item_id, quantity FROM order_items WHERE order_id = p_order_id LOOP
        UPDATE inventory SET quantity_reserved = quantity_reserved - row_item.quantity WHERE item_id = row_item.item_id;
    END LOOP;
    UPDATE orders SET status = 'cancelled' WHERE id = p_order_id;
END;
$$ LANGUAGE plpgsql;

-- View: Báo cáo tồn kho tổng hợp
CREATE OR REPLACE VIEW v_inventory_report AS
SELECT 
    t.code AS sku, 
    t.name AS product_name, 
    t.type AS item_type,
    t.unit AS unit,                      -- Bổ sung dòng này để hết lỗi
    i.quantity_on_hand AS total_stock, 
    i.quantity_reserved AS reserved_stock, 
    i.quantity_available AS available_stock,
    CASE 
        WHEN i.quantity_available <= 0 THEN 'Hết hàng' 
        WHEN i.quantity_available < 10 THEN 'Sắp hết' 
        ELSE 'Sẵn có' 
    END AS stock_status
FROM items t 
JOIN inventory i ON t.id = i.item_id 
ORDER BY i.quantity_available ASC;

-- View: Cảnh báo nguyên liệu sắp hết (< 5 đơn vị)
CREATE OR REPLACE VIEW v_low_stock_alerts AS
SELECT product_name, available_stock, unit FROM v_inventory_report WHERE available_stock < 5 AND item_type = 'raw_material';

-- PHÂN QUYỀN (RLS) - Cần thiết để Website đọc được dữ liệu
-- Dọn dẹp các Policy cũ để tránh trùng lặp
DROP POLICY IF EXISTS "Allow all" ON items;
DROP POLICY IF EXISTS "Allow all" ON inventory;
DROP POLICY IF EXISTS "Allow all" ON orders;
DROP POLICY IF EXISTS "Allow all" ON order_items;
DROP POLICY IF EXISTS "Allow all" ON stock_in;

-- Tạo lại các Policy mới (Cho phép Toàn quyền - Thích hợp để Test)
CREATE POLICY "Allow all" ON items FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all" ON inventory FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all" ON orders FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all" ON order_items FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all" ON stock_in FOR ALL USING (true) WITH CHECK (true);

-- Đảm bảo RLS đã được bật
ALTER TABLE items ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_in ENABLE ROW LEVEL SECURITY;

