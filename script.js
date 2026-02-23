// Khởi tạo biến toàn cục
let orderCount = 1000;

// Hàm tạo hiệu ứng đom đóm
function createFireflies() {
    for (let i = 0; i < 15; i++) {
        const firefly = document.createElement('div');
        firefly.className = 'firefly';
        firefly.style.left = Math.random() * 100 + 'vw';
        firefly.style.top = Math.random() * 100 + 'vh';
        firefly.style.animationDuration = (Math.random() * 10 + 15) + 's';
        firefly.style.animationDelay = (Math.random() * 5) + 's';
        document.body.appendChild(firefly);
    }
}

// Hàm xử lý đặt hàng chính
window.processOrder = function() {
    const nameInput = document.getElementById('custName');
    const productSelect = document.getElementById('productSelect');
    
    if (!nameInput || !productSelect) return;

    const name = nameInput.value.trim();
    const product = productSelect.value;

    if (!name) {
        alert("🧙‍♂️ Phù thủy cần biết tên khách hàng để làm phép!");
        return;
    }

    orderCount++;
    const orderID = `PNL-${orderCount}`;

    const createItemHTML = (target) => `
        <div class="order-item animate-in" id="item-${orderID}-${target}">
            <div style="display: flex; justify-content: space-between; align-items: center;">
                <span class="id-tag">${orderID}</span>
                ${target === 'mes' ? `<button onclick="finishProduction('${orderID}')" class="btn-finish">✨ Xong</button>` : `<small>📦 Đang chuẩn bị</small>`}
            </div>
            <p style="margin: 8px 0;"><b>${product}</b></p>
            <p style="font-size: 0.85rem; color: #ccc;">Khách: ${name}</p>
            <small>🕒 ${new Date().toLocaleTimeString('vi-VN', {hour: '2-digit', minute:'2-digit'})}</small>
        </div>
    `;

    const mesQueue = document.getElementById('mes-queue');
    const wmsQueue = document.getElementById('wms-queue');

    if (mesQueue.innerHTML.includes('empty-msg')) mesQueue.innerHTML = '';
    if (wmsQueue.innerHTML.includes('empty-msg')) wmsQueue.innerHTML = '';

    mesQueue.insertAdjacentHTML('afterbegin', createItemHTML('mes'));
    wmsQueue.insertAdjacentHTML('afterbegin', createItemHTML('wms'));

    nameInput.value = '';
    console.log(`✅ Đã tạo đơn ${orderID}`);
};

// Hàm hoàn thành sản xuất
window.finishProduction = function(id) {
    const mesItem = document.getElementById(`item-${id}-mes`);
    const wmsItem = document.getElementById(`item-${id}-wms`);
    
    if(mesItem) {
        mesItem.style.opacity = '0.3';
        mesItem.style.transform = 'scale(0.95)';
    }

    if(wmsItem) {
        wmsItem.style.borderLeft = '4px solid #40916c';
        wmsItem.innerHTML = `
            <span class="id-tag" style="background:#40916c">HOÀN TẤT</span>
            <p style="margin-top:8px">Đơn <b>${id}</b> đã nhập kho thành phẩm!</p>
        `;
    }
    
    setTimeout(() => {
        if(mesItem) mesItem.remove();
        if(document.getElementById('mes-queue').children.length === 0) {
            document.getElementById('mes-queue').innerHTML = '<p class="empty-msg">Chờ lệnh sản xuất...</p>';
        }
    }, 5000);
};
// navbar <code></code>
async function showSection(sectionName) {
    const contentArea = document.getElementById('content-area');
    
    try {
        // 1. Tải nội dung HTML
        const response = await fetch(`./${sectionName}/index.html`);
        if (!response.ok) throw new Error('Không tìm thấy giao diện');
        const html = await response.text();
        contentArea.innerHTML = html;

        // 2. Xóa script cũ của module trước đó (nếu có) để tránh xung đột
        const oldScript = document.getElementById('module-script');
        if (oldScript) oldScript.remove();

        // 3. Nạp script mới của module hiện tại
        // Lưu ý: Chỉ nạp nếu bạn có tạo file script.js trong thư mục đó
        const newScript = document.createElement('script');
        newScript.src = `./${sectionName}/script.js`;
        newScript.id = 'module-script';
        newScript.type = 'text/javascript';
        
        // Đảm bảo script chạy sau khi HTML đã được chèn
        document.body.appendChild(newScript);

        console.log(`✨ Đã kích hoạt Module: ${sectionName.toUpperCase()}`);
    } catch (error) {
        contentArea.innerHTML = `<div class="card glass">⚠️ Lỗi: ${error.message}</div>`;
    }
}

// Khởi chạy khi trang tải xong
document.addEventListener('DOMContentLoaded', () => {
    createFireflies();
    
    document.querySelectorAll('.nav-menu li').forEach(item => {
        item.addEventListener('click', function() {
            const activeItem = document.querySelector('.nav-menu li.active');
            if(activeItem) activeItem.classList.remove('active');
            this.classList.add('active');
        });
    });
});
