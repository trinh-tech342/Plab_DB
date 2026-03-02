// ==========================================
// 1. CẤU HÌNH KẾT NỐI SUPABASE
// ==========================================
const SUPABASE_URL = 'https://uraqirnglqfqtqthuztf.supabase.co';
const SUPABASE_KEY = 'sb_publishable_akdtRUN42J85roi7UCupzA_6thndrkD';
const _supabase = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// ==========================================
// 2. KHỞI TẠO HỆ THỐNG (DOM CONTENT LOADED)
// ==========================================
document.addEventListener('DOMContentLoaded', () => {
  createFireflies(); // Tạo đom đóm
  loadProductsFromDB(); // Lấy SP từ Database
  setupNavbar(); // Cài đặt menu
});

// ==========================================
// 3. LOGIC XỬ LÝ DATABASE (SUPABASE)
// ==========================================

// Lấy danh sách sản phẩm thành phẩm (Finished Goods)
async function loadProductsFromDB() {
  const { data, error } = await _supabase
    .from('items')
    .select('id, name')
    .eq('type', 'finished_good');

  if (data) {
    const select = document.getElementById('productSelect');
    if (select) {
      select.innerHTML = data
        .map((item) => `<option value="${item.id}">${item.name}</option>`)
        .join('');
    }
  } else if (error) {
    console.error('Lỗi load sản phẩm:', error.message);
  }
}

// Hàm xử lý đặt hàng chính (Insert SQL + Hiển thị UI)
window.processOrder = async function () {
  const nameInput = document.getElementById('custName');
  const productSelect = document.getElementById('productSelect');

  const name = nameInput.value.trim();
  const itemId = productSelect.value;
  const productName = productSelect.options[productSelect.selectedIndex].text;

  if (!name) {
    alert('🧙‍♂️ Phù thủy cần biết tên khách hàng để làm phép!');
    return;
  }

  // A. Ghi vào Database (Bảng orders)
  const { data: order, error: orderErr } = await _supabase
    .from('orders')
    .insert([{ customer_name: name, status: 'pending' }])
    .select();

  if (orderErr) {
    alert('Lỗi tạo đơn: ' + orderErr.message);
    return;
  }

  const orderDB = order[0];

  // B. Ghi vào order_items (Trigger SQL sẽ tự giữ kho)
  const { error: itemErr } = await _supabase
    .from('order_items')
    .insert([{ order_id: orderDB.id, item_id: itemId, quantity: 1 }]);

  if (itemErr) {
    alert('Kho không đủ hàng hoặc lỗi hệ thống: ' + itemErr.message);
    return;
  }

  // C. Cập nhật UI (Hiển thị card đơn hàng mới)
  updateOrderUI(orderDB.id, productName, name);
  nameInput.value = ''; // Reset input
  alert('✨ Phép thuật thành công! Đơn hàng đã ghi vào SQL.');
};

// Hàm hiển thị Card đơn hàng lên màn hình
function updateOrderUI(orderID, product, customer) {
  const shortID = orderID.substring(0, 8); // Lấy 8 ký tự đầu của UUID

  const createItemHTML = (target) => `
        <div class="order-item animate-in" id="item-${orderID}-${target}">
            <div style="display: flex; justify-content: space-between; align-items: center;">
                <span class="id-tag">${shortID}</span>
                ${target === 'mes' ? `<button onclick="finishProduction('${orderID}')" class="btn-finish">✨ Xong</button>` : `<small>📦 Đang chuẩn bị</small>`}
            </div>
            <p style="margin: 8px 0;"><b>${product}</b></p>
            <p style="font-size: 0.85rem; color: #ccc;">Khách: ${customer}</p>
            <small>🕒 ${new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}</small>
        </div>
    `;

  const mesQueue = document.getElementById('mes-queue');
  const wmsQueue = document.getElementById('wms-queue');

  if (mesQueue.innerHTML.includes('empty-msg')) mesQueue.innerHTML = '';
  if (wmsQueue.innerHTML.includes('empty-msg')) wmsQueue.innerHTML = '';

  mesQueue.insertAdjacentHTML('afterbegin', createItemHTML('mes'));
  wmsQueue.insertAdjacentHTML('afterbegin', createItemHTML('wms'));
}

// Hàm hoàn thành sản xuất (Gọi hàm confirm_order_shipping trong SQL)
window.finishProduction = async function (orderId) {
  // 1. Lấy thông tin chi tiết đơn hàng để biết sản phẩm nào cần sản xuất
  const { data: orderItems } = await _supabase
    .from('order_items')
    .select('item_id, quantity')
    .eq('order_id', orderId)
    .single();

  if (!orderItems) return;

  // 2. Gọi hàm "Phù thủy" MES trong SQL để trừ nguyên liệu & cộng thành phẩm
  // Chúng ta dùng RPC để gọi hàm mes_complete_production đã viết ở SQL
  const { error: mesError } = await _supabase.rpc('mes_complete_production', {
    p_product_id: orderItems.item_id,
    p_produce_qty: orderItems.quantity,
  });

  if (mesError) {
    alert('🧙‍♂️ Lỗi sản xuất: ' + mesError.message);
    return;
  }

  // 3. Sau khi sản xuất xong, tiến hành xác nhận xuất kho cho khách
  const { error: shipError } = await _supabase.rpc('confirm_order_shipping', {
    p_order_id: orderId,
  });

  if (shipError) {
    alert('Lỗi xuất kho: ' + shipError.message);
    return;
  }

  // 4. Hiệu ứng UI (Giữ nguyên phần hiệu ứng của bạn)
  renderFinishEffect(orderId);
  alert('✨ Đã hoàn tất: Nguyên liệu đã trừ, Thành phẩm đã xuất!');
};

// Hàm phụ để tách biệt phần hiệu ứng giao diện
function renderFinishEffect(id) {
  const mesItem = document.getElementById(`item-${id}-mes`);
  const wmsItem = document.getElementById(`item-${id}-wms`);
  if (mesItem) {
    mesItem.style.opacity = '0.3';
    mesItem.style.transform = 'scale(0.95)';
  }
  if (wmsItem) {
    wmsItem.style.borderLeft = '4px solid #40916c';
    wmsItem.innerHTML = `<span class="id-tag" style="background:#40916c">HOÀN TẤT</span><p>Đơn <b>${id.substring(0, 8)}</b> đã xong!</p>`;
  }
  setTimeout(() => {
    mesItem?.remove();
  }, 3000);
}

// ==========================================
// 4. HIỆU ỨNG UI & NAVIGATION
// ==========================================

function createFireflies() {
  for (let i = 0; i < 15; i++) {
    const firefly = document.createElement('div');
    firefly.className = 'firefly';
    firefly.style.left = Math.random() * 100 + 'vw';
    firefly.style.top = Math.random() * 100 + 'vh';
    firefly.style.animationDuration = Math.random() * 10 + 15 + 's';
    firefly.style.animationDelay = Math.random() * 5 + 's';
    document.body.appendChild(firefly);
  }
}

function setupNavbar() {
  document.querySelectorAll('.nav-menu li').forEach((item) => {
    item.addEventListener('click', function () {
      document.querySelector('.nav-menu li.active')?.classList.remove('active');
      this.classList.add('active');
    });
  });
}

// Hàm chuyển đổi Section (Dành cho bản GitHub sau này)
async function showSection(sectionName) {
  const contentArea = document.getElementById('content-area');
  // Lưu ý: JSFiddle không fetch được file cục bộ, hàm này dùng để bạn chuẩn bị cho bản GitHub
  console.log('Đang chuyển hướng tới section:', sectionName);
}
// ==========================================
// 5. MODAL
// ==========================================
function openModal(type) {
  const container = document.getElementById('modal-container');
  const body = document.getElementById('modal-body');
  container.style.display = 'flex';

  // Cập nhật phần WMS trong hàm openModal
  // Thêm vào trong script.js
// Thay thế đoạn 'farming-modal' cũ của bạn bằng đoạn này
if (type === 'farming-modal') {
    body.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: center;">
            <h2>🌿 Nhật ký canh tác Organic</h2>
            <button onclick="exportOrganicReport()" class="btn-finish" style="background:#2d6a4f">📄 Xuất báo cáo</button>
        </div>

        <div class="order-input-group" style="display: grid; gap: 10px; margin-top:10px;">
            <select id="log-plot-id"><option>Đang tải lô đất...</option></select>
            
            <select id="log-activity">
                <option value="Sowing">🌱 Gieo hạt</option>
                <option value="Fertilizing">🥣 Bón phân</option>
                <option value="Pest_Control">🛡️ Trị sâu bệnh</option>
                <option value="Harvesting">🧺 Thu hoạch</option>
                <option value="Watering">💧 Tưới nước</option>
            </select>
            
            <select id="log-item-id"><option value="">-- Chọn vật tư (nếu có) --</option></select>
            
            <input type="number" id="log-qty" placeholder="Số lượng vật tư sử dụng...">
            <input type="text" id="log-desc" placeholder="Mô tả chi tiết công việc...">

            <div class="upload-area" style="margin: 5px 0; padding: 10px; border: 1px dashed #40916c; border-radius: 8px; text-align: center;">
                <label for="file-upload" class="btn-finish" style="cursor:pointer; background:#40916c; display:inline-block; padding: 8px 15px; font-size: 0.9rem;">
                    📸 Chụp ảnh bằng chứng
                </label>
                <input type="file" id="file-upload" accept="image/*" style="display:none" onchange="previewImage(this)">
                
                <div id="upload-status" style="font-size: 0.8rem; margin-top:5px; color: #ccc;">Chưa có ảnh nào được chọn</div>
                
                <input type="hidden" id="log-evidence-url">
            </div>
            
            <button onclick="saveFarmingLog()" class="btn-magic">✨ Ghi vào hồ sơ Organic</button>
        </div>

        <hr style="margin: 20px 0; border: 0.5px solid #444;">
        <h3>Lịch sử canh tác gần đây</h3>
        <div id="farming-history" style="max-height: 250px; overflow-y: auto;"></div>
    `;
    
    // Kích hoạt các hàm load dữ liệu
    loadPlotsAndLogs(); 
    loadFarmingResources();
}
  if (type === 'wms-modal') {
    body.innerHTML = `
        <h2>🏠 Quản lý Kho Vận (WMS)</h2>
        <div class="order-input-group">
            <input type="text" id="wms-sku" placeholder="Mã SKU (Vd: PHOI_XP)...">
            <input type="number" id="wms-qty" placeholder="Số lượng...">
            <button onclick="handleWMSIn()" class="btn-magic">Nhập kho nhanh</button>
        </div>
        <div id="inventory-table-container" style="margin-top: 20px;">
            <p class="empty-msg">Đang tải dữ liệu kho...</p>
        </div>
    `;
    fetchInventory(); // Gọi hàm lấy dữ liệu ngay khi mở modal
  } else if (type === 'mes-modal') {
    body.innerHTML = `
            <h2>🧪 Quản lý Sản xuất (MES)</h2>
            <button onclick="printBOM()" class="btn-magic">In Công thức (BOM)</button>
            <button onclick="getProductionReport()" class="btn-magic" style="margin-top:10px">Báo cáo sản xuất</button>
            <div id="mes-report-area" style="margin-top:15px"></div>
        `;
  }
}
async function fetchInventory() {
  const container = document.getElementById('inventory-table-container');
  if (!container) return;

  // Truy vấn dữ liệu từ View
  const { data, error } = await _supabase
    .from('v_inventory_report')
    .select('*');

  if (error) {
    container.innerHTML = `<p style="color:red">Lỗi SQL: ${error.message}</p>`;
    return;
  }

  if (!data || data.length === 0) {
    container.innerHTML = `<p class="empty-msg">Kho đang trống hoặc chưa có dữ liệu mẫu.</p>`;
    return;
  }

  let html = `
        <table class="magic-table">
            <thead>
                <tr>
                    <th>Mặt hàng</th>
                    <th>Loại</th>
                    <th>Tồn kho</th>
                    <th>Đang giữ</th>
                </tr>
            </thead>
            <tbody>
    `;

  data.forEach((item) => {
    // --- KHẮC PHỤC LỖI TẠI ĐÂY ---
    // 1. Khai báo biến 'type' dựa trên item_type từ database
    const typeLabel = item.item_type === 'finished_good' ? '📦 TP' : '🌿 NL';

    // 2. Sử dụng đúng tên cột từ View v_inventory_report
    // Nếu kết quả trả về undefined, hãy kiểm tra lại tên cột trong SQL Editor
    const name = item.product_name || 'N/A';
    const onHand = item.total_stock ?? 0;
    const reserved = item.reserved_stock ?? 0;

    html += `
            <tr>
                <td><b>${name}</b></td>
                <td><small>${typeLabel}</small></td>
                <td>${onHand}</td>
                <td style="opacity: 0.6">${reserved}</td>
            </tr>
        `;
  });

  html += `</tbody></table>`;
  container.innerHTML = html;
}
function closeModal() {
  document.getElementById('modal-container').style.display = 'none';
}

//Liên két với supabase
// WMS: Nhập hàng nhanh
async function handleWMSIn() {
  const sku = document.getElementById('wms-sku').value;
  const qty = document.getElementById('wms-qty').value;

  const { error } = await _supabase.rpc('quick_stock_in', {
    p_sku: sku,
    p_qty: parseFloat(qty),
  });

  if (error) {
    alert('Lỗi: ' + error.message);
  } else {
    alert('✅ Nhập kho thành công!');
    fetchInventory(); // <--- Dòng này giúp bảng cập nhật ngay lập tức con số mới
    document.getElementById('wms-qty').value = ''; // Xóa số lượng đã nhập
  }
}

// MES: Lấy báo cáo sản xuất
async function getProductionReport() {
  const { data, error } = await _supabase
    .from('v_production_stats')
    .select('*');
  let html = '<ul>';
  data.forEach((item) => {
    html += `<li>${item.product_name}: <b>${item.total_sold}</b> bánh</li>`;
  });
  html += '</ul>';
  document.getElementById('mes-report-area').innerHTML = html;
}

// MES: In BOM (Mở cửa sổ in)
async function printBOM() {
  const { data } = await _supabase
    .from('bom')
    .select('*, items!parent_item_id(name)');
  // Logic in đơn giản: mở cửa sổ mới và window.print()
  let printWindow = window.open('', '_blank');
  printWindow.document.write('<h1>BẢN IN CÔNG THỨC SẢN XUẤT</h1>');
  data.forEach((b) => {
    printWindow.document.write(
      `<p>- SP: ${b.items.name} cần ${b.quantity_required} đơn vị nguyên liệu</p>`,
    );
  });
  printWindow.print();
}
// ==========================================
// QUẢN LÝ NHẬT KÝ CANH TÁC ORGANIC
// ==========================================

// 1. Tải Lô đất và Lịch sử nhật ký gần đây
async function loadPlotsAndLogs() {
    const plotSelect = document.getElementById('log-plot-id');
    const historyDiv = document.getElementById('farming-history');

    // Lấy danh sách lô đất từ Database
    const { data: plots } = await _supabase.from('plots').select('*');
    if (plots && plotSelect) {
        plotSelect.innerHTML = plots.map(p => 
            `<option value="${p.id}">${p.name} (${p.crop_type})</option>`
        ).join('');
    }

    // Lấy 10 nhật ký từ View tổng hợp (Hiển thị đẹp hơn)
    const { data: logs, error } = await _supabase
        .from('v_organic_compliance_report')
        .select('*')
        .limit(10);

    if (logs && historyDiv) {
        historyDiv.innerHTML = logs.map(l => `
            <div class="order-item" style="border-left: 4px solid #40916c; margin-bottom: 8px; background: rgba(64, 145, 108, 0.05);">
                <div style="display: flex; justify-content: space-between; align-items: center;">
                    <small>📅 ${l.activity_date}</small>
                    <span class="id-tag" style="background: ${l.organic_status === 'compliant' ? '#2d6a4f' : '#e74c3c'}">
                        ${l.organic_status}
                    </span>
                </div>
                <p style="margin: 5px 0;"><b>${l.plot_name}</b>: ${l.activity_type}</p>
                <p style="font-size: 0.85rem; color: #ddd;">Vật tư: ${l.input_used || 'Không'} | Lượng: ${l.input_quantity || 0}</p>
            </div>
        `).join('');
    }
}

// 2. Tải danh sách vật tư Organic vào Dropdown
async function loadFarmingResources() {
    const resSelect = document.getElementById('log-item-id');
    if (!resSelect) return;

    const { data: resources } = await _supabase
        .from('items')
        .select('id, name, organic_cert_no')
        .eq('type', 'raw_material')
        .eq('is_organic_approved', true);

    if (resources) {
        resSelect.innerHTML = '<option value="">-- Không dùng vật tư --</option>' + 
            resources.map(r => 
                `<option value="${r.id}">${r.name} (${r.organic_cert_no || 'Chưa có CC'})</option>`
            ).join('');
    }
}

// 3. Hàm lưu Nhật ký (Hợp nhất Logic xử lý & UI)
window.saveFarmingLog = async function() {
    // Thu thập dữ liệu từ giao diện
    const plotId = document.getElementById('log-plot-id').value;
    const activity = document.getElementById('log-activity').value;
    const itemId = document.getElementById('log-item-id').value;
    const qty = document.getElementById('log-qty').value;
    const desc = document.getElementById('log-desc').value;
    const imageUrl = document.getElementById('log-evidence-url')?.value || '';

    if (!plotId) {
        alert("🧙‍♂️ Vui lòng chọn lô đất để ghi chép!");
        return;
    }

    // Gửi dữ liệu lên Supabase
    const { error } = await _supabase.from('farming_logs').insert([{
        plot_id: plotId,
        activity_type: activity,
        input_item_id: itemId || null,
        input_quantity: qty ? parseFloat(qty) : 0,
        description: desc,
        evidence_url: imageUrl,
        worker_name: "Farmer Pinelab" // Có thể thay bằng biến user nếu có hệ thống login
    }]);

    if (error) {
        alert("⚠️ Cảnh báo: " + error.message);
    } else {
        alert("🌿 Tuyệt vời! Nhật ký đã lưu, kho vật tư đã tự động trừ.");
        
        // Reset form sau khi lưu thành công
        if(document.getElementById('log-qty')) document.getElementById('log-qty').value = '';
        if(document.getElementById('log-desc')) document.getElementById('log-desc').value = '';
        if(document.getElementById('log-evidence-url')) document.getElementById('log-evidence-url').value = '';
        
        // Tải lại danh sách hiển thị
        loadPlotsAndLogs();
    }
}

// 4. Xuất báo cáo CSV cho đoàn đánh giá
window.exportOrganicReport = async function() {
    const { data, error } = await _supabase
        .from('v_organic_traceability_report')
        .select('*');

    if (error || !data || data.length === 0) {
        alert("Lỗi hoặc không có dữ liệu để xuất!");
        return;
    }

    const headers = Object.keys(data[0]).join(",");
    const rows = data.map(row => 
        Object.values(row).map(val => `"${val}"`).join(",")
    ).join("\n");

    const csvContent = "data:text/csv;charset=utf-8,\uFEFF" + headers + "\n" + rows;
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `Bao_Cao_Organic_${new Date().toLocaleDateString()}.csv`);
    document.body.appendChild(link);
    link.click();
    link.remove();
};

//Hàm xử lý Upload "Ma thuật" (JS)
// 1. Hàm xem trước và tự động Upload khi chọn ảnh
async function previewImage(input) {
    const file = input.files[0];
    if (!file) return;

    const status = document.getElementById('upload-status');
    const hiddenUrlInput = document.getElementById('log-evidence-url');
    
    status.innerHTML = `<span style="color: #f1c40f;">⏳ Đang tải ảnh lên...</span>`;

    // Tạo tên file độc nhất để tránh trùng lặp
    const fileExt = file.name.split('.').pop();
    const fileName = `${Date.now()}.${fileExt}`;
    const filePath = `evidences/${fileName}`;

    // 1. Upload file vào Bucket 'farming-evidences'
    const { data, error } = await _supabase.storage
        .from('farming-evidences')
        .upload(filePath, file);

    if (error) {
        status.innerHTML = `<span style="color: #e74c3c;">❌ Lỗi: ${error.message}</span>`;
        return;
    }

    // 2. Lấy Public URL của file vừa upload
    const { data: { publicUrl } } = _supabase.storage
        .from('farming-evidences')
        .getPublicUrl(filePath);

    // 3. Lưu URL vào input ẩn và cập nhật UI
    hiddenUrlInput.value = publicUrl;
    status.innerHTML = `<span style="color: #2ecc71;">✅ Đã lưu ảnh bằng chứng!</span>`;
}
