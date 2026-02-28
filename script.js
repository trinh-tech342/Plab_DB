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
window.finishProduction = async function (id) {
  const { error } = await _supabase.rpc('confirm_order_shipping', {
    p_order_id: id,
  });

  if (error) {
    alert('Lỗi xuất kho: ' + error.message);
    return;
  }

  // Hiệu ứng UI sau khi nhấn Xong
  const mesItem = document.getElementById(`item-${id}-mes`);
  const wmsItem = document.getElementById(`item-${id}-wms`);

  if (mesItem) {
    mesItem.style.opacity = '0.3';
    mesItem.style.transform = 'scale(0.95)';
  }

  if (wmsItem) {
    wmsItem.style.borderLeft = '4px solid #40916c';
    wmsItem.innerHTML = `
            <span class="id-tag" style="background:#40916c">HOÀN TẤT</span>
            <p style="margin-top:8px">Đơn <b>${id.substring(0, 8)}</b> đã xuất kho thực tế!</p>
        `;
  }

  setTimeout(() => {
    if (mesItem) mesItem.remove();
    if (document.getElementById('mes-queue').children.length === 0) {
      document.getElementById('mes-queue').innerHTML =
        '<p class="empty-msg">Chờ lệnh sản xuất...</p>';
    }
  }, 3000);
};

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
