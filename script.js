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
  // Gọi hàm RPC mới
  const { data: newBatchNo, error: mesError } = await _supabase.rpc(
    'mes_complete_production',
    {
      p_product_id: orderItems.item_id,
      p_produce_qty: orderItems.quantity,
      p_order_id: orderId,
    },
  );

  if (mesError) {
    alert('🧙‍♂️ Lỗi sản xuất: ' + mesError.message);
    return;
  }
  // Thông báo số lô cho người dùng
  alert(
    `✨ Sản xuất hoàn tất! \nSố lô tự động: ${newBatchNo} \nNguyên liệu đã trừ & Hồ sơ lô đã được tạo.`,
  );
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
window.showSection = async function(type) {
    const content = document.getElementById('content-area');
    
    if (type === 'dashboard') {
        content.innerHTML = `
            <div class="dashboard-header">
                <h2>📊 Trạm Chỉ Huy Pinelab</h2>
                <p id="last-updated" style="font-size: 0.8rem; color: #666;"></p>
            </div>

            <div class="stats-grid">
                <div class="stat-card bg-danger">
                    <i class="fas fa-exclamation-triangle"></i>
                    <h3 id="dash-low-stock">0</h3>
                    <p>Vật tư sắp hết</p>
                </div>
                <div class="stat-card bg-warning">
                    <i class="fas fa-stamp"></i>
                    <h3 id="dash-pending-qc">0</h3>
                    <p>Lô chờ duyệt QC</p>
                </div>
                <div class="stat-card bg-success">
                    <i class="fas fa-leaf"></i>
                    <h3 id="dash-organic-rate">0%</h3>
                    <p>Tỷ lệ Organic</p>
                </div>
                <div class="stat-card bg-info">
                    <i class="fas fa-shopping-cart"></i>
                    <h3 id="dash-pending-orders">0</h3>
                    <p>Đơn hàng mới</p>
                </div>
            </div>

            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px;">
                <div class="card glass">
                    <h3><i class="fas fa-history"></i> Hoạt động Nông trại gần nhất</h3>
                    <div id="dash-recent-farming" style="margin-top:10px;">Đang tải...</div>
                </div>
                <div class="card glass">
                    <h3><i class="fas fa-truck-loading"></i> Danh sách cần nhập hàng</h3>
                    <div id="dash-restock-list" style="margin-top:10px;">Đang tải...</div>
                </div>
            </div>
        `;
        // Kích hoạt lấy dữ liệu thực
        renderDashboardData();

    } else if (type === 'oms') {
        content.innerHTML = `<h2>📦 Quản lý đơn hàng (OMS)</h2><div id="oms-list">...</div>`;
        // Gọi hàm load đơn hàng của bạn ở đây
    }
};

async function renderDashboardData() {
    // 1. Lấy dữ liệu từ View Tồn kho
    const { data: invData } = await _supabase.from('v_inventory_report').select('*');
    const lowStockItems = invData?.filter(i => i.stock_status !== 'Sẵn có') || [];
    
    // 2. Lấy số lô chờ duyệt QC
    const { count: pendingQC } = await _supabase.from('batch_records').select('*', { count: 'exact', head: true }).eq('qc_status', 'pending');

    // 3. Lấy số đơn hàng mới
    const { count: pendingOrders } = await _supabase.from('orders').select('*', { count: 'exact', head: true }).eq('status', 'pending');

    // 4. Tính tỷ lệ Organic
    const { data: items } = await _supabase.from('items').select('is_organic_approved');
    const organicRate = items?.length ? Math.round((items.filter(i => i.is_organic_approved).length / items.length) * 100) : 0;

    // 5. Lấy nhật ký canh tác mới nhất
    const { data: farmLog } = await _supabase.from('farming_logs').select('activity_type, worker_name, created_at').order('created_at', { ascending: false }).limit(1);

    // CẬP NHẬT GIAO DIỆN
    document.getElementById('dash-low-stock').innerText = lowStockItems.length;
    document.getElementById('dash-pending-qc').innerText = pendingQC || 0;
    document.getElementById('dash-organic-rate').innerText = organicRate + '%';
    document.getElementById('dash-pending-orders').innerText = pendingOrders || 0;
    document.getElementById('last-updated').innerText = "Cập nhật lúc: " + new Date().toLocaleTimeString();

    // Render danh sách cần nhập hàng nhanh
    const restockDiv = document.getElementById('dash-restock-list');
    if (lowStockItems.length > 0) {
        restockDiv.innerHTML = lowStockItems.map(i => `
            <div style="display:flex; justify-content:space-between; padding:5px 0; border-bottom:1px solid #eee;">
                <span>${i.product_name}</span>
                <b style="color:#d90429;">${i.available_stock} ${i.unit}</b>
            </div>
        `).join('');
    } else {
        restockDiv.innerHTML = "<p style='color:green'>✅ Kho hàng đang rất an toàn!</p>";
    }

    // Render hoạt động nông trại
    const farmDiv = document.getElementById('dash-recent-farming');
    if (farmLog?.length) {
        farmDiv.innerHTML = `
            <div style="padding:10px; background:rgba(45,106,79,0.05); border-radius:10px;">
                <p><b>Hoạt động:</b> ${farmLog[0].activity_type}</p>
                <p><b>Nhân viên:</b> ${farmLog[0].worker_name}</p>
                <p><small>${new Date(farmLog[0].created_at).toLocaleString()}</small></p>
            </div>
        `;
    } else {
        farmDiv.innerHTML = "<p>Chưa có nhật ký hôm nay.</p>";
    }
}

// Hàm phụ trợ để đổ số liệu vào Dashboard
async function updateDashboardStats() {
    // 1. Đếm số mặt hàng trong kho
    const { count: itemCount } = await _supabase
        .from('items')
        .select('*', { count: 'exact', head: true });
    
    // 2. Đếm số đơn hàng đang 'pending'
    const { count: orderCount } = await _supabase
        .from('orders')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'pending');

    document.getElementById('stat-inventory-count').innerText = itemCount || 0;
    document.getElementById('stat-order-count').innerText = orderCount || 0;
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
        <h2>🧪 Hồ Sơ Lô Sản Xuất (Batch Records)</h2>
        <div class="order-input-group" style="display: flex; gap: 10px;">
            <input type="text" id="search-batch-no" placeholder="Nhập số lô (Vd: BATCH-123)...">
            <button onclick="viewBatchDetail()" class="btn-magic">🔍 Tra cứu</button>
        </div>
        
        <div id="batch-report-display" style="margin-top: 20px; min-height: 200px; background: #fff; color: #333; padding: 20px; border-radius: 8px; display: none;">
            </div>
        
        <div id="batch-actions" style="margin-top: 15px; display: none; gap: 10px;">
            <button onclick="approveQC()" class="btn-finish" style="background: #d90429;">印 Đóng dấu QC PASS</button>
            <button onclick="exportBatchPDF()" class="btn-magic">📄 Xuất file PDF</button>
        </div>
    `;
  }
}
async function fetchInventory() {
  const container = document.getElementById('inventory-table-container');
  if (!container) return;

  // 1. Truy vấn dữ liệu từ View v_inventory_report
  const { data, error } = await _supabase
    .from('v_inventory_report')
    .select('*');

  if (error) {
    container.innerHTML = `<p style="color:red; padding:10px;">❌ Lỗi SQL: ${error.message}</p>`;
    return;
  }

  if (!data || data.length === 0) {
    container.innerHTML = `<p class="empty-msg" style="padding:20px;">📦 Kho đang trống hoặc chưa có dữ liệu mẫu.</p>`;
    return;
  }

  // 2. Khởi tạo bảng với class magic-table để giữ CSS đẹp của bạn
  let html = `
        <table class="magic-table" style="width:100%; border-collapse: collapse; background: #fff; color: #333;">
            <thead>
                <tr style="background: #2d6a4f; color: #fff;">
                    <th style="padding:10px; border:1px solid #ddd;">SKU</th>
                    <th style="padding:10px; border:1px solid #ddd;">Mặt hàng</th>
                    <th style="padding:10px; border:1px solid #ddd;">Loại</th>
                    <th style="padding:10px; border:1px solid #ddd;">Tồn kho</th>
                    <th style="padding:10px; border:1px solid #ddd;">Sẵn có</th>
                    <th style="padding:10px; border:1px solid #ddd;">Trạng thái</th>
                </tr>
            </thead>
            <tbody>
    `;

  data.forEach((item) => {
    // Xử lý nhãn loại sản phẩm
    const typeLabel = item.item_type === 'finished_good' ? '📦 TP' : '🌿 NL';
    
    // Xử lý màu sắc trạng thái (Lấy logic từ loadInventoryTable)
    const statusColor = item.stock_status === 'Hết hàng' ? '#d90429' : (item.stock_status === 'Sắp hết' ? '#f77f00' : '#2d6a4f');

    html += `
            <tr style="border-bottom: 1px solid #eee;">
                <td style="padding:10px; border:1px solid #ddd;"><small><code>${item.sku}</code></small></td>
                <td style="padding:10px; border:1px solid #ddd;"><b>${item.product_name || 'N/A'}</b></td>
                <td style="padding:10px; border:1px solid #ddd; text-align:center;"><small>${typeLabel}</small></td>
                <td style="padding:10px; border:1px solid #ddd; text-align:right;">${item.total_stock ?? 0}</td>
                <td style="padding:10px; border:1px solid #ddd; text-align:right; font-weight:bold;">${item.available_stock ?? 0}</td>
                <td style="padding:10px; border:1px solid #ddd; text-align:center; color:${statusColor}; font-weight:bold;">
                    ${item.stock_status}
                </td>
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
    plotSelect.innerHTML = plots
      .map((p) => `<option value="${p.id}">${p.name} (${p.crop_type})</option>`)
      .join('');
  }

  // Lấy 10 nhật ký từ View tổng hợp (Hiển thị đẹp hơn)
  const { data: logs, error } = await _supabase
    .from('v_organic_traceability_report')
    .select('*')
    .limit(10);

  if (logs && historyDiv) {
    historyDiv.innerHTML = logs
      .map(
        (l) => `
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
        `,
      )
      .join('');
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
    resSelect.innerHTML =
      '<option value="">-- Không dùng vật tư --</option>' +
      resources
        .map(
          (r) =>
            `<option value="${r.id}">${r.name} (${r.organic_cert_no || 'Chưa có CC'})</option>`,
        )
        .join('');
  }
}

// 3. Hàm lưu Nhật ký (Hợp nhất Logic xử lý & UI)
window.saveFarmingLog = async function () {
  // Thu thập dữ liệu từ giao diện
  const plotId = document.getElementById('log-plot-id').value;
  const activity = document.getElementById('log-activity').value;
  const itemId = document.getElementById('log-item-id').value;
  const qty = document.getElementById('log-qty').value;
  const desc = document.getElementById('log-desc').value;
  const imageUrl = document.getElementById('log-evidence-url')?.value || '';

  if (!plotId) {
    alert('🧙‍♂️ Vui lòng chọn lô đất để ghi chép!');
    return;
  }

  // Gửi dữ liệu lên Supabase
  const { error } = await _supabase.from('farming_logs').insert([
    {
      plot_id: plotId,
      activity_type: activity,
      input_item_id: itemId || null,
      input_quantity: qty ? parseFloat(qty) : 0,
      description: desc,
      evidence_url: imageUrl,
      worker_name: 'Farmer Pinelab', // Có thể thay bằng biến user nếu có hệ thống login
    },
  ]);

  if (error) {
    alert('⚠️ Cảnh báo: ' + error.message);
  } else {
    alert('🌿 Tuyệt vời! Nhật ký đã lưu, kho vật tư đã tự động trừ.');

    // Reset form sau khi lưu thành công
    if (document.getElementById('log-qty'))
      document.getElementById('log-qty').value = '';
    if (document.getElementById('log-desc'))
      document.getElementById('log-desc').value = '';
    if (document.getElementById('log-evidence-url'))
      document.getElementById('log-evidence-url').value = '';

    // Tải lại danh sách hiển thị
    loadPlotsAndLogs();
  }
};

// 4. Xuất báo cáo CSV cho đoàn đánh giá
window.exportOrganicReport = async function () {
  const { data, error } = await _supabase
    .from('v_organic_traceability_report')
    .select('*');

  if (error || !data || data.length === 0) {
    alert('Lỗi hoặc không có dữ liệu để xuất!');
    return;
  }

  const headers = Object.keys(data[0]).join(',');
  const rows = data
    .map((row) =>
      Object.values(row)
        .map((val) => `"${val}"`)
        .join(','),
    )
    .join('\n');

  const csvContent =
    'data:text/csv;charset=utf-8,\uFEFF' + headers + '\n' + rows;
  const encodedUri = encodeURI(csvContent);
  const link = document.createElement('a');
  link.setAttribute('href', encodedUri);
  link.setAttribute(
    'download',
    `Bao_Cao_Organic_${new Date().toLocaleDateString()}.csv`,
  );
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
  const {
    data: { publicUrl },
  } = _supabase.storage.from('farming-evidences').getPublicUrl(filePath);

  // 3. Lưu URL vào input ẩn và cập nhật UI
  hiddenUrlInput.value = publicUrl;
  status.innerHTML = `<span style="color: #2ecc71;">✅ Đã lưu ảnh bằng chứng!</span>`;
}
// con dấu QC PASS
async function viewBatchDetail() {
    const batchNo = document.getElementById('search-batch-no').value;
    const { data, error } = await _supabase.rpc('get_batch_report', { p_batch_number: batchNo });

    if (error || !data.length) {
        alert('Không tìm thấy số lô này!');
        return;
    }

    const b = data[0];
    const display = document.getElementById('batch-report-display');
    const actions = document.getElementById('batch-actions');

    display.style.display = 'block';
    actions.style.display = 'flex';

    display.innerHTML = `
        <div id="pdf-content" style="border: 2px solid #333; padding: 30px; color: #000; background: #fff; min-height: 500px; position: relative; -webkit-print-color-adjust: exact;">
            
            <div style="display: flex; justify-content: space-between; align-items: start; border-bottom: 2px solid #333; margin-bottom: 20px; padding-bottom: 10px;">
                <div id="qrcode" style="padding: 5px; border: 1px solid #eee;"></div> 
                <div style="text-align: center; flex-grow: 1;">
                    <h1 style="margin: 0; font-size: 24px;">HỒ SƠ LÔ SẢN XUẤT</h1>
                    <p style="margin: 5px 0; color: #666;">Hệ thống Quản lý Pinelab ERP & Organic</p>
                </div>
                <div style="width: 80px;"></div>
            </div>

            <table style="width: 100%; margin-bottom: 20px; border-collapse: collapse; font-size: 16px;">
                <tr>
                    <td style="padding: 8px; border: 1px solid #ddd;"><b>Số lô:</b> ${b.batch_no}</td>
                    <td style="padding: 8px; border: 1px solid #ddd; text-align: right;"><b>Ngày SX:</b> ${new Date(b.created_at).toLocaleDateString()}</td>
                </tr>
                <tr>
                    <td style="padding: 8px; border: 1px solid #ddd;"><b>Tên sản phẩm:</b> <span style="font-size: 18px; color: #2d6a4f;">${b.product_name}</span></td>
                    <td style="padding: 8px; border: 1px solid #ddd; text-align: right;"><b>Số lượng:</b> ${b.quantity} ${b.unit || 'PCS'}</td>
                </tr>
                <tr>
                    <td colspan="2" style="padding: 8px; border: 1px solid #ddd;"><b>Khách hàng:</b> ${b.customer || 'Kho dự trữ'}</td>
                </tr>
            </table>

            <h3 style="background: #f0f0f0; padding: 8px; border-left: 5px solid #2d6a4f; margin-top: 20px;">I. THÀNH PHẦN NGUYÊN LIỆU (BOM SNAPSHOT)</h3>
            <table style="width: 100%; border: 1px solid #ccc; border-collapse: collapse;">
                <thead>
                    <tr style="background: #f9f9f9;">
                        <th style="border: 1px solid #ccc; padding: 10px;">Tên nguyên liệu</th>
                        <th style="border: 1px solid #ccc; padding: 10px; text-align: right;">Định lượng thực tế</th>
                    </tr>
                </thead>
                <tbody>
                    ${b.bom_data?.map(item => `
                        <tr>
                            <td style="border: 1px solid #ccc; padding: 10px;">${item.name}</td>
                            <td style="border: 1px solid #ccc; padding: 10px; text-align: right;">${item.qty} ${item.unit}</td>
                        </tr>
                    `).join('') || '<tr><td colspan="2">Không có dữ liệu công thức</td></tr>'}
                </tbody>
            </table>

            <div style="margin-top: 50px; display: flex; justify-content: space-between; align-items: flex-end;">
                <div style="text-align: center; width: 250px;">
                    <p>Người lập hồ sơ</p>
                    <br><br><br>
                    <p><b>Farmer Pinelab</b></p>
                </div>
                
                <div style="width: 150px; height: 120px; display: flex; align-items: center; justify-content: center;">
                    ${b.qc_status === 'PASSED' ? `
                        <div class="qc-stamp" style="border: 4px double #d90429; color: #d90429; padding: 10px; transform: rotate(-15deg); font-weight: bold; border-radius: 50%; width: 100px; height: 100px; display: flex; align-items: center; justify-content: center; text-align: center; background: rgba(217, 4, 41, 0.05); font-size: 18px;">
                            QC<br>PASSED
                        </div>
                    ` : '<p style="color: #aaa; font-style: italic;">Chờ QC kiểm duyệt...</p>'}
                </div>
            </div>
        </div>
    `;

    // TẠO MÃ QR (Chạy sau khi gán HTML)
    new QRCode(document.getElementById("qrcode"), {
        text: "https://pinelab.vn/trace/" + b.batch_no,
        width: 80,
        height: 80
    });
}
// XUẤT PDF mes
window.exportBatchPDF = function () {
  const printContents = document.getElementById('pdf-content').innerHTML;

  // Tạo một cửa sổ in mới hoàn toàn để không bị dính CSS của giao diện chính
  const printWindow = window.open('', '_blank', 'width=800,height=1000');

  printWindow.document.write(`
        <html>
            <head>
                <title>Hồ sơ lô - ${document.getElementById('search-batch-no').value}</title>
                <style>
                    body { 
                        font-family: Arial, sans-serif; 
                        padding: 20px; 
                        background: white !important; /* Ép nền trắng */
                        color: black !important;
                    }
                    /* Ép trình duyệt in màu và khung */
                    * { 
                        -webkit-print-color-adjust: exact !important; 
                        print-color-adjust: exact !important; 
                    }
                    table { width: 100%; border-collapse: collapse; margin: 15px 0; }
                    th, td { border: 1px solid #333; padding: 10px; text-align: left; }
                    .qc-stamp {
                        border: 4px double #d90429;
                        color: #d90429;
                        padding: 10px;
                        transform: rotate(-15deg);
                        font-weight: bold;
                        border-radius: 50%;
                        width: 80px;
                        height: 80px;
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        text-align: center;
                        font-size: 14px;
                    }
                </style>
            </head>
            <body onload="window.print();window.close();">
                <div style="border: 2px solid #000; padding: 20px;">
                    ${printContents}
                </div>
            </body>
        </html>
    `);

  printWindow.document.close();
};
// DẨU ĐỎ QC PASS
window.approveQC = async function () {
  const batchNo = document.getElementById('search-batch-no').value;
  const staffName = 'Trưởng phòng QC - Pinelab'; // Có thể lấy từ hệ thống login

  const { error } = await _supabase
    .from('batch_records')
    .update({
      qc_status: 'PASSED',
      qc_staff: staffName,
    })
    .eq('batch_number', batchNo);

  if (error) {
    alert('Lỗi đóng dấu: ' + error.message);
  } else {
    alert('印 Đã đóng dấu QC PASS thành công!');
    viewBatchDetail(); // Tải lại giao diện để hiện dấu đỏ
  }
};
