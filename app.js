document.addEventListener("DOMContentLoaded", () => {
  // Estado da Aplicação
  const state = {
    products: window.PRODUCTS_DATA || [],
    cart: [],
    selectedWeights: {}, // Mapeia { productId: selectedWeightKey }
    activeCategory: "all",
    searchTerm: "",
    pollingInterval: null
  };

  // Inicializa o peso padrão para cada produto (primeira opção disponível)
  state.products.forEach(product => {
    const weights = Object.keys(product.prices);
    if (weights.length > 0) {
      state.selectedWeights[product.id] = weights[0];
    }
  });

  // Elementos do DOM
  const productsGrid = document.getElementById("products-grid");
  const searchInput = document.getElementById("search-input");
  const categoriesFilter = document.getElementById("categories-filter");
  const cartFloatBtn = document.getElementById("cart-float-btn");
  const cartOverlay = document.getElementById("cart-overlay");
  const cartDrawer = document.getElementById("cart-drawer");
  const closeCartBtn = document.getElementById("close-cart-btn");
  const cartItemsList = document.getElementById("cart-items-list");
  const cartItemsQty = document.getElementById("cart-items-qty");
  const cartTotalValue = document.getElementById("cart-total-value");
  const cartBadgeCount = document.getElementById("cart-badge-count");
  
  // Elementos do Checkout
  const drawerTitle = document.getElementById("drawer-title");
  const btnGoToCheckout = document.getElementById("btn-go-to-checkout");
  const btnBackToCart = document.getElementById("btn-back-to-cart");
  const btnGeneratePix = document.getElementById("btn-generate-pix");
  const checkoutFormContainer = document.getElementById("checkout-form-container");
  const checkoutActions = document.getElementById("checkout-actions");
  const checkoutForm = document.getElementById("checkout-form");

  // Elementos do Modal Pix
  const pixModalOverlay = document.getElementById("pix-modal-overlay");
  const pixQrCodeImg = document.getElementById("pix-qr-code-img");
  const pixCodeInput = document.getElementById("pix-code-input");
  const btnCopyPix = document.getElementById("btn-copy-pix");
  const btnSimulatePayment = document.getElementById("btn-simulate-payment");

  // Elementos do Modal de Sucesso
  const successModalOverlay = document.getElementById("success-modal-overlay");
  const successOrderId = document.getElementById("success-order-id");
  const successInvoiceStatus = document.getElementById("success-invoice-status");
  const btnCloseSuccess = document.getElementById("btn-close-success");

  // Modal de Informações Gerais
  const infoModalOverlay = document.getElementById("info-modal-overlay");
  const infoModalClose = document.getElementById("info-modal-close");
  const infoModalTitle = document.getElementById("info-modal-title");
  const infoModalBody = document.getElementById("info-modal-body");

  // --- FUNÇÕES DE RENDERIZAÇÃO ---

  function formatCurrency(value) {
    return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  }

  function renderProducts() {
    productsGrid.innerHTML = "";

    const filteredProducts = state.products.filter(product => {
      const matchesCategory = state.activeCategory === "all" || product.category === state.activeCategory;
      const matchesSearch = product.name.toLowerCase().includes(state.searchTerm.toLowerCase()) ||
                            (product.description && product.description.toLowerCase().includes(state.searchTerm.toLowerCase()));
      return matchesCategory && matchesSearch;
    });

    if (filteredProducts.length === 0) {
      productsGrid.innerHTML = `
        <div style="grid-column: 1/-1; text-align: center; padding: 3rem 0; color: var(--text-muted);">
          <p style="font-size: 1.2rem; font-weight: 500;">Nenhum produto encontrado...</p>
          <p style="font-size: 0.9rem; margin-top: 0.5rem;">Tente buscar por outro termo ou categoria.</p>
        </div>
      `;
      return;
    }

    filteredProducts.forEach(product => {
      const card = document.createElement("div");
      card.className = "product-card";
      card.setAttribute("data-id", product.id);

      const categoryLabels = {
        "oleaginosas": "Castanhas & Oleaginosas",
        "farinhas": "Farinhas",
        "sementes-graos": "Sementes & Grãos",
        "granola-mixes": "Granolas & Mixes",
        "frutas-doces": "Frutas & Doces"
      };
      const categoryLabel = categoryLabels[product.category] || product.category;

      const weights = Object.keys(product.prices);
      const selectedWeight = state.selectedWeights[product.id];
      
      let priceRowsHTML = "";
      weights.forEach(weight => {
        const isSelected = weight === selectedWeight;
        priceRowsHTML += `
          <div class="price-option-row ${isSelected ? 'selected' : ''}" data-weight="${weight}">
            <div class="option-weight">
              <input type="radio" name="weight-${product.id}" value="${weight}" ${isSelected ? 'checked' : ''}>
              <span>${weight}</span>
            </div>
            <div class="option-price">${formatCurrency(product.prices[weight])}</div>
          </div>
        `;
      });

      let infoBulletHTML = "";
      if (product.description && product.id !== "farinha-felicidade" && product.id !== "mix-graos" && product.id !== "mix-sementes-torrada") {
        infoBulletHTML = `<span class="info-bullet">${product.description}</span>`;
      }

      let recipeLinkHTML = "";
      if (product.recipe) {
        recipeLinkHTML = `<span class="recipe-link" data-id="${product.id}">Como Consumir / Ingredientes</span>`;
      } else if (product.id === "mix-graos" || product.id === "mix-sementes-torrada") {
        recipeLinkHTML = `<span class="recipe-link" data-id="${product.id}">Ver itens inclusos no mix</span>`;
      }

      card.innerHTML = `
        <div class="product-image-wrapper">
          <img src="${product.image}" alt="${product.name}" class="product-image" loading="lazy" onerror="this.src='https://images.unsplash.com/photo-1590080875515-8a3a8dc5735e?auto=format&fit=crop&q=80&w=400';">
          <span class="product-tag">${categoryLabel}</span>
        </div>
        <div class="product-content">
          <h3 class="product-title">${product.name}</h3>
          ${infoBulletHTML}
          ${recipeLinkHTML}
          <div class="price-options">
            ${priceRowsHTML}
          </div>
          <button class="add-to-cart-btn" data-id="${product.id}">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="21" r="1"></circle><circle cx="20" cy="21" r="1"></circle><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"></path></svg>
            Adicionar ao Carrinho
          </button>
        </div>
      `;

      card.querySelectorAll(".price-option-row").forEach(row => {
        row.addEventListener("click", (e) => {
          if (e.target.tagName === "INPUT") return;
          const weight = row.getAttribute("data-weight");
          state.selectedWeights[product.id] = weight;
          
          card.querySelectorAll(".price-option-row").forEach(r => r.classList.remove("selected"));
          card.querySelectorAll("input[type='radio']").forEach(radio => radio.checked = false);
          
          row.classList.add("selected");
          row.querySelector("input").checked = true;
        });
      });

      card.querySelector(".add-to-cart-btn").addEventListener("click", () => {
        addToCart(product.id);
      });

      const recipeLink = card.querySelector(".recipe-link");
      if (recipeLink) {
        recipeLink.addEventListener("click", () => {
          openInfoModal(product);
        });
      }

      productsGrid.appendChild(card);
    });
  }

  // --- FUNÇÕES DO CARRINHO ---

  function openCart() {
    // Reset view to Cart (in case it was closed in Checkout state)
    showCartView();
    cartOverlay.classList.add("active");
    document.body.style.overflow = "hidden";
  }

  function closeCart() {
    cartOverlay.classList.remove("active");
    document.body.style.overflow = "";
  }

  function addToCart(productId) {
    const product = state.products.find(p => p.id === productId);
    const weight = state.selectedWeights[productId];
    const price = product.prices[weight];

    const existingIndex = state.cart.findIndex(item => item.id === productId && item.weight === weight);

    if (existingIndex > -1) {
      state.cart[existingIndex].quantity += 1;
    } else {
      state.cart.push({
        id: product.id,
        name: product.name,
        weight: weight,
        price: price,
        image: product.image,
        quantity: 1
      });
    }

    updateCartUI();
    openCart();
  }

  function updateCartQuantity(index, delta) {
    state.cart[index].quantity += delta;
    if (state.cart[index].quantity <= 0) {
      state.cart.splice(index, 1);
    }
    updateCartUI();
  }

  function removeFromCart(index) {
    state.cart.splice(index, 1);
    updateCartUI();
  }

  function updateCartUI() {
    cartItemsList.innerHTML = "";
    let totalItemsCount = 0;
    let totalPrice = 0;

    if (state.cart.length === 0) {
      cartItemsList.innerHTML = `
        <div class="empty-cart-message">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="21" r="1"></circle><circle cx="20" cy="21" r="1"></circle><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"></path></svg>
          <p>Seu carrinho está vazio.</p>
          <p style="font-size: 0.85rem;">Escolha produtos saudáveis no catálogo para adicionar!</p>
        </div>
      `;
      btnGoToCheckout.disabled = true;
    } else {
      state.cart.forEach((item, index) => {
        totalItemsCount += item.quantity;
        const itemTotal = item.price * item.quantity;
        totalPrice += itemTotal;

        const cartItemEl = document.createElement("div");
        cartItemEl.className = "cart-item";
        cartItemEl.innerHTML = `
          <img src="${item.image}" alt="${item.name}" class="cart-item-image" onerror="this.src='https://images.unsplash.com/photo-1590080875515-8a3a8dc5735e?auto=format&fit=crop&q=80&w=100';">
          <div class="cart-item-info">
            <h4 class="cart-item-name">${item.name}</h4>
            <div class="cart-item-meta">${item.weight} - ${formatCurrency(item.price)} cada</div>
            <div class="cart-item-controls">
              <div class="qty-selector">
                <button class="qty-btn minus-btn" data-index="${index}">&minus;</button>
                <span class="qty-val">${item.quantity}</span>
                <button class="qty-btn plus-btn" data-index="${index}">&plus;</button>
              </div>
              <span class="cart-item-price">${formatCurrency(itemTotal)}</span>
            </div>
            <button class="remove-item-btn" data-index="${index}">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
              Excluir
            </button>
          </div>
        `;

        cartItemEl.querySelector(".minus-btn").addEventListener("click", () => updateCartQuantity(index, -1));
        cartItemEl.querySelector(".plus-btn").addEventListener("click", () => updateCartQuantity(index, 1));
        cartItemEl.querySelector(".remove-item-btn").addEventListener("click", () => removeFromCart(index));

        cartItemsList.appendChild(cartItemEl);
      });
      btnGoToCheckout.disabled = false;
    }

    cartItemsQty.textContent = totalItemsCount;
    cartBadgeCount.textContent = totalItemsCount;
    cartTotalValue.textContent = formatCurrency(totalPrice);
  }

  // --- CONTROLE DE TELAS (CARRINHO VS FORMULÁRIO DE CHECKOUT) ---

  function showCheckoutView() {
    drawerTitle.textContent = "Identificação";
    cartItemsList.style.display = "none";
    checkoutFormContainer.style.display = "block";
    btnGoToCheckout.style.display = "none";
    checkoutActions.style.display = "flex";
  }

  function showCartView() {
    drawerTitle.textContent = "Seu Carrinho";
    cartItemsList.style.display = "flex";
    checkoutFormContainer.style.display = "none";
    btnGoToCheckout.style.display = "block";
    checkoutActions.style.display = "none";
  }

  // --- EFETUAR CHECKOUT (GERAR PIX) ---

  async function handleCheckout() {
    // Valida o formulário antes de enviar
    if (!checkoutForm.checkValidity()) {
      checkoutForm.reportValidity();
      return;
    }

    const clientData = {
      name: document.getElementById("client-name").value,
      cpf: document.getElementById("client-cpf").value,
      email: document.getElementById("client-email").value,
      phone: document.getElementById("client-phone").value,
      zip: document.getElementById("client-zip").value,
      city: document.getElementById("client-city").value,
      street: document.getElementById("client-street").value,
      number: document.getElementById("client-number").value,
      neighborhood: document.getElementById("client-neighborhood").value
    };

    btnGeneratePix.disabled = true;
    btnGeneratePix.textContent = "Gerando Pix...";

    try {
      const response = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client: clientData,
          cart: state.cart
        })
      });

      const orderData = await response.json();
      
      if (response.ok) {
        closeCart();
        showPixModal(orderData);
      } else {
        alert(orderData.error || "Erro ao gerar cobrança Pix. Tente novamente.");
        btnGeneratePix.disabled = false;
        btnGeneratePix.textContent = "Confirmar e Gerar Pix";
      }
    } catch (err) {
      console.error(err);
      alert("Erro ao conectar ao servidor. Verifique se o servidor backend está rodando.");
      btnGeneratePix.disabled = false;
      btnGeneratePix.textContent = "Confirmar e Gerar Pix";
    }
  }

  // --- TELA DO PIX (MODAL) ---

  function showPixModal(orderData) {
    pixQrCodeImg.src = orderData.qrCodeUrl;
    pixCodeInput.value = orderData.pixCode;
    
    // Configura botões do modal
    btnCopyPix.onclick = () => {
      pixCodeInput.select();
      navigator.clipboard.writeText(orderData.pixCode);
      btnCopyPix.textContent = "Copiado!";
      btnCopyPix.style.backgroundColor = "var(--primary)";
      setTimeout(() => {
        btnCopyPix.textContent = "Copiar";
        btnCopyPix.style.backgroundColor = "var(--accent)";
      }, 2000);
    };

    // Configura simulação de pagamento de teste
    btnSimulatePayment.onclick = async () => {
      try {
        const res = await fetch(`/api/simulate-payment/${orderData.orderId}`, { method: "POST" });
        const data = await res.json();
        console.log("Simulador de pagamento acionado:", data.message);
      } catch (err) {
        console.error("Erro ao simular pagamento:", err);
      }
    };

    pixModalOverlay.classList.add("active");
    document.body.style.overflow = "hidden";

    // Inicia o Polling de checagem do status de pagamento
    startPaymentStatusPolling(orderData.orderId);
  }

  function closePixModal() {
    pixModalOverlay.classList.remove("active");
    document.body.style.overflow = "";
    if (state.pollingInterval) {
      clearInterval(state.pollingInterval);
      state.pollingInterval = null;
    }
  }

  // --- CHECAGEM EM TEMPO REAL (POLLING) ---

  function startPaymentStatusPolling(orderId) {
    if (state.pollingInterval) clearInterval(state.pollingInterval);

    state.pollingInterval = setInterval(async () => {
      try {
        const res = await fetch(`/api/order/status/${orderId}`);
        const data = await res.json();
        
        if (res.ok && data.status === "paid") {
          // Parar polling
          clearInterval(state.pollingInterval);
          state.pollingInterval = null;
          
          // Fecha modal do Pix e abre o de sucesso
          closePixModal();
          showSuccessModal(orderId, data.invoice_status, data.invoice_id);
        }
      } catch (err) {
        console.warn("Erro ao checar status do pedido:", err);
      }
    }, 3000); // Checa a cada 3 segundos
  }

  // --- TELA DE SUCESSO (MODAL) ---

  function showSuccessModal(orderId, invoiceStatus, invoiceId) {
    successOrderId.textContent = orderId;
    
    if (invoiceStatus === "emitted") {
      successInvoiceStatus.innerHTML = `<span style="color:#065f46">Emitida com Sucesso!</span><br><small style="font-size:0.7rem; color:var(--text-muted); word-break:break-all;">Chave: ${invoiceId}</small>`;
    } else if (invoiceStatus === "failed") {
      successInvoiceStatus.textContent = "Erro na SEFAZ (Tentando novamente)";
      successInvoiceStatus.style.color = "#991b1b";
    } else {
      successInvoiceStatus.textContent = "Processando na SEFAZ...";
      successInvoiceStatus.style.color = "#1e40af";
    }

    successModalOverlay.classList.add("active");
    document.body.style.overflow = "hidden";

    // Limpa o carrinho local
    state.cart = [];
    updateCartUI();
  }

  function closeSuccessModal() {
    successModalOverlay.classList.remove("active");
    document.body.style.overflow = "";
  }

  // --- MODAL DE DETALHES ---

  function openInfoModal(product) {
    infoModalTitle.textContent = product.name;
    
    if (product.id === "farinha-felicidade") {
      infoModalBody.innerHTML = `
        <p><strong>Descrição:</strong> ${product.description}</p>
        <h4 style="margin-top: 1rem;">Como Consumir:</h4>
        <p>${product.recipe}</p>
      `;
    } else if (product.id === "mix-graos" || product.id === "mix-sementes-torrada") {
      infoModalBody.innerHTML = `
        <p><strong>Itens inclusos neste mix saudável:</strong></p>
        <p style="margin-top: 0.5rem; line-height: 1.8;">${product.description}</p>
        <h4 style="margin-top: 1rem;">Dica de consumo:</h4>
        <p>Excelente para consumir puro como snack, adicionar em saladas, iogurtes, açaí ou levar na bolsa como lanche prático.</p>
      `;
    }

    infoModalOverlay.classList.add("active");
    document.body.style.overflow = "hidden";
  }

  function closeInfoModal() {
    infoModalOverlay.classList.remove("active");
    if (!cartOverlay.classList.contains("active") && !pixModalOverlay.classList.contains("active") && !successModalOverlay.classList.contains("active")) {
      document.body.style.overflow = "";
    }
  }

  // --- EVENT LISTENERS GERAIS ---

  searchInput.addEventListener("input", (e) => {
    state.searchTerm = e.target.value;
    renderProducts();
  });

  categoriesFilter.addEventListener("click", (e) => {
    const btn = e.target.closest(".filter-btn");
    if (!btn) return;

    categoriesFilter.querySelectorAll(".filter-btn").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");

    state.activeCategory = btn.getAttribute("data-category");
    renderProducts();
  });

  // Carrinho Drawer
  cartFloatBtn.addEventListener("click", openCart);
  closeCartBtn.addEventListener("click", closeCart);
  
  cartOverlay.addEventListener("click", (e) => {
    if (e.target === cartOverlay) {
      closeCart();
    }
  });

  // Controle de Visualização do Carrinho/Checkout
  btnGoToCheckout.addEventListener("click", showCheckoutView);
  btnBackToCart.addEventListener("click", showCartView);
  btnGeneratePix.addEventListener("click", handleCheckout);

  // Fechar modals
  infoModalOverlay.addEventListener("click", (e) => {
    if (e.target === infoModalOverlay) closeInfoModal();
  });
  infoModalClose.addEventListener("click", closeInfoModal);

  btnCloseSuccess.addEventListener("click", closeSuccessModal);

  // Inicialização
  renderProducts();
  updateCartUI();
});
