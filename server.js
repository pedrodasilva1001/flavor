const express = require("express");
const cors = require("cors");
const path = require("path");
const fs = require("fs");
const sqlite3 = require("sqlite3").verbose();

const app = express();
const PORT = process.env.PORT || 8000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname)));

// Carrega Configurações
let config = {
  pixKey: "sabordaterravls@gmail.com",
  merchantName: "Sabor da Terra",
  merchantCity: "Valinhos",
  simulationMode: true
};

const configPath = path.join(__dirname, "config.json");
if (fs.existsSync(configPath)) {
  try {
    config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    console.log("Configurações carregadas com sucesso!");
  } catch (err) {
    console.error("Erro ao carregar config.json, usando valores padrão:", err);
  }
}

// Banco de Dados SQLite
const dbPath = path.join(__dirname, "database.db");
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error("Erro ao conectar no banco de dados:", err);
  } else {
    console.log("Banco de dados SQLite conectado com sucesso!");
    initDatabase();
  }
});

// Inicialização das tabelas
function initDatabase() {
  db.serialize(() => {
    // Tabela de Pedidos
    db.run(`
      CREATE TABLE IF NOT EXISTS pedidos (
        id TEXT PRIMARY KEY,
        client_name TEXT,
        client_cpf TEXT,
        client_email TEXT,
        client_phone TEXT,
        client_zip TEXT,
        client_address TEXT,
        total REAL,
        status TEXT,
        pix_code TEXT,
        invoice_status TEXT,
        invoice_id TEXT,
        created_at TEXT
      )
    `);

    // Tabela de Itens de Pedidos
    db.run(`
      CREATE TABLE IF NOT EXISTS itens_pedido (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        order_id TEXT,
        product_id TEXT,
        product_name TEXT,
        weight TEXT,
        quantity INTEGER,
        price REAL,
        FOREIGN KEY(order_id) REFERENCES pedidos(id)
      )
    `);
  });
}

// --- AUXILIAR: Gerador de BR Code Pix Estático (Valor Dinâmico) ---
// Especificação simplificada do BR Code do Banco Central para simulação
function generateBRCode(pixKey, amount, merchantName, merchantCity) {
  // Versão simplificada que funciona para testes de BR Code
  const cleanKey = pixKey.replace(/[^\w@.-]/g, "");
  const cleanName = merchantName.substring(0, 25).toUpperCase();
  const cleanCity = merchantCity.substring(0, 15).toUpperCase();
  const cleanAmount = parseFloat(amount).toFixed(2);

  // Formato do payload padrão BACEN (EMV CO-CP-01)
  const formatField = (id, val) => {
    const len = val.length.toString().padStart(2, "0");
    return `${id}${len}${val}`;
  };

  // Sub-IDs do Merchant Account Info (ID 26)
  const merchantAccountInfo = formatField("00", "br.gov.bcb.pix") + formatField("01", cleanKey);

  const payload = [
    formatField("00", "01"), // Payload Format Indicator
    formatField("26", merchantAccountInfo), // Merchant Account Information
    formatField("52", "0000"), // Merchant Category Code
    formatField("53", "986"), // Transaction Currency (986 = Real BRL)
    formatField("54", cleanAmount), // Transaction Amount
    formatField("58", "BR"), // Country Code
    formatField("59", cleanName), // Merchant Name
    formatField("60", cleanCity), // Merchant City
    formatField("62", formatField("05", "ST0001")) // Additional Data (TxID)
  ].join("");

  // Adiciona CRC16 no final
  const payloadWithCrcPlaceholder = payload + "6304";
  
  // Função básica de CRC16 CCITT
  let crc = 0xFFFF;
  for (let i = 0; i < payloadWithCrcPlaceholder.length; i++) {
    const charCode = payloadWithCrcPlaceholder.charCodeAt(i);
    crc ^= (charCode << 8);
    for (let j = 0; j < 8; j++) {
      if ((crc & 0x8000) !== 0) {
        crc = (crc << 1) ^ 0x1021;
      } else {
        crc = (crc << 1);
      }
    }
  }
  const crcHex = (crc & 0xFFFF).toString(16).toUpperCase().padStart(4, "0");
  
  return payload + "6304" + crcHex;
}

// --- ROTAS DA API ---

// Rota 1: Checkout - Cria pedido e gera o Pix
app.post("/api/checkout", (req, res) => {
  const { client, cart } = req.body;

  if (!client || !cart || cart.length === 0) {
    return res.status(400).json({ error: "Dados inválidos para checkout." });
  }

  // Gera ID único
  const orderId = `ST-${Date.now().toString().slice(-6)}-${Math.floor(Math.random() * 1000)}`;
  
  // Calcula Total
  let total = 0;
  cart.forEach(item => {
    total += item.price * item.quantity;
  });

  const createdAt = new Date().toISOString();
  let pixCode = "";
  let qrCodeUrl = "";

  if (config.simulationMode) {
    // SIMULAÇÃO: Gera BR Code Pix Estático de Valor Dinâmico localmente
    pixCode = generateBRCode(config.pixKey, total, config.merchantName, config.merchantCity);
    // Usa uma API pública para gerar a imagem do QR Code
    qrCodeUrl = `https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${encodeURIComponent(pixCode)}`;
    saveOrder();
  } else {
    // REAL: Integração com a API do Mercado Pago
    // (Para este exemplo, criamos a estrutura, mas caso falhe ou falte credencial, faz fallback para simulado)
    const https = require("https");
    const postData = JSON.stringify({
      transaction_amount: parseFloat(total.toFixed(2)),
      description: `Pedido ${orderId} - Sabor da Terra`,
      payment_method_id: "pix",
      payer: {
        email: client.email,
        first_name: client.name.split(" ")[0] || "Cliente",
        last_name: client.name.split(" ").slice(1).join(" ") || "Sabor",
        identification: {
          type: "CPF",
          number: client.cpf.replace(/[^\d]/g, "")
        }
      }
    });

    const options = {
      hostname: "api.mercadopago.com",
      port: 443,
      path: "/v1/payments",
      method: "POST",
      headers: {
        "Authorization": `Bearer ${config.mercadoPago.accessToken}`,
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(postData)
      }
    };

    const mpReq = https.request(options, (mpRes) => {
      let body = "";
      mpRes.on("data", (d) => body += d);
      mpRes.on("end", () => {
        try {
          const resData = JSON.parse(body);
          if (mpRes.statusCode === 201 && resData.point_of_interaction) {
            pixCode = resData.point_of_interaction.transaction_data.qr_code;
            qrCodeUrl = `data:image/jpeg;base64,${resData.point_of_interaction.transaction_data.qr_code_base64}`;
            saveOrder();
          } else {
            console.warn("Mercado Pago retornou erro, usando modo simulado:", resData);
            fallbackToSimulated();
          }
        } catch (e) {
          console.error("Erro ao analisar resposta do Mercado Pago:", e);
          fallbackToSimulated();
        }
      });
    });

    mpReq.on("error", (e) => {
      console.error("Erro na requisição ao Mercado Pago:", e);
      fallbackToSimulated();
    });

    mpReq.write(postData);
    mpReq.end();
  }

  function fallbackToSimulated() {
    pixCode = generateBRCode(config.pixKey, total, config.merchantName, config.merchantCity);
    qrCodeUrl = `https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${encodeURIComponent(pixCode)}`;
    saveOrder();
  }

  function saveOrder() {
    // Insere pedido no banco
    db.run(
      `INSERT INTO pedidos (id, client_name, client_cpf, client_email, client_phone, client_zip, client_address, total, status, pix_code, invoice_status, invoice_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        orderId,
        client.name,
        client.cpf,
        client.email,
        client.phone,
        client.zip,
        `${client.street}, ${client.number} - ${client.neighborhood}, ${client.city}`,
        total,
        "pending",
        pixCode,
        "pending",
        "",
        createdAt
      ],
      function (err) {
        if (err) {
          console.error("Erro ao salvar pedido:", err);
          return res.status(500).json({ error: "Erro interno ao salvar pedido." });
        }

        // Insere itens do pedido
        const stmt = db.prepare(`
          INSERT INTO itens_pedido (order_id, product_id, product_name, weight, quantity, price)
          VALUES (?, ?, ?, ?, ?, ?)
        `);

        cart.forEach(item => {
          stmt.run(orderId, item.id, item.name, item.weight, item.quantity, item.price);
        });

        stmt.finalize();

        res.json({
          orderId,
          total,
          pixCode,
          qrCodeUrl,
          status: "pending"
        });
      }
    );
  }
});

// Rota 2: Verifica status do pedido (usado por Polling na tela)
app.get("/api/order/status/:id", (req, res) => {
  const orderId = req.params.id;

  db.get("SELECT status, invoice_status, invoice_id FROM pedidos WHERE id = ?", [orderId], (err, row) => {
    if (err) {
      console.error(err);
      return res.status(500).json({ error: "Erro ao consultar status." });
    }
    if (!row) {
      return res.status(404).json({ error: "Pedido não encontrado." });
    }
    res.json(row);
  });
});

// Rota 3: Simulador de Confirmação de Pagamento (Developer/Test Tool)
// Permite ao usuário clicar em "Simular Pagamento" no frontend para confirmar o Pix sem precisar pagar de verdade
app.post("/api/simulate-payment/:id", (req, res) => {
  const orderId = req.params.id;

  db.get("SELECT * FROM pedidos WHERE id = ?", [orderId], (err, order) => {
    if (err || !order) {
      return res.status(404).json({ error: "Pedido não encontrado para simulação." });
    }

    if (order.status === "paid") {
      return res.json({ message: "Pedido já estava pago.", order });
    }

    // Altera o status para Pago
    db.run("UPDATE pedidos SET status = 'paid' WHERE id = ?", [orderId], (err) => {
      if (err) {
        return res.status(500).json({ error: "Erro ao atualizar status." });
      }

      // Busca os itens para constar no log e simulação
      db.all("SELECT * FROM itens_pedido WHERE order_id = ?", [orderId], (err, items) => {
        // Dispara as automações assincronamente (E-mail + Nota Fiscal)
        processAutomations(order, items);
        
        res.json({
          message: "Pagamento simulado com sucesso!",
          orderId,
          status: "paid"
        });
      });
    });
  });
});

// Rota 4: Webhook real do intermediador (Mercado Pago / Asaas)
app.post("/api/webhooks/payment", (req, res) => {
  // Responde imediatamente com 200 OK para evitar timeouts
  res.sendStatus(200);

  const payload = req.body;
  console.log("Webhook recebido:", payload);

  // Exemplo básico para Mercado Pago (IPN / Webhook de pagamento)
  if (payload.type === "payment" && payload.data && payload.data.id) {
    const paymentId = payload.data.id;
    
    // Consulta o pagamento no Mercado Pago
    const https = require("https");
    const options = {
      hostname: "api.mercadopago.com",
      port: 443,
      path: `/v1/payments/${paymentId}`,
      method: "GET",
      headers: {
        "Authorization": `Bearer ${config.mercadoPago.accessToken}`
      }
    };

    const mpReq = https.request(options, (mpRes) => {
      let body = "";
      mpRes.on("data", (d) => body += d);
      mpRes.on("end", () => {
        try {
          const paymentData = JSON.parse(body);
          if (paymentData.status === "approved") {
            const externalRef = paymentData.external_reference; // Deve conter o orderId
            
            // Localiza o pedido no banco
            db.get("SELECT * FROM pedidos WHERE id = ? OR pix_code = ?", [externalRef, paymentData.point_of_interaction?.transaction_data?.qr_code], (err, order) => {
              if (order && order.status === "pending") {
                db.run("UPDATE pedidos SET status = 'paid' WHERE id = ?", [order.id], () => {
                  db.all("SELECT * FROM itens_pedido WHERE order_id = ?", [order.id], (err, items) => {
                    processAutomations(order, items);
                  });
                });
              }
            });
          }
        } catch (e) {
          console.error("Erro ao processar dados do webhook:", e);
        }
      });
    });
    mpReq.end();
  }
});

// --- FUNÇÃO AUXILIAR: PROCESSA AUTOMATIZAÇÕES (E-MAIL + NOTA FISCAL SEFAZ) ---
function processAutomations(order, items) {
  console.log(`\n--- INICIANDO AUTOMATIZAÇÕES PARA O PEDIDO ${order.id} ---`);

  // 1. Simulação / Envio do E-mail para a Empresa
  console.log(`[E-MAIL] Preparando e-mail de notificação para: ${config.email.notifyTo}`);
  const itemsText = items.map(item => `  - ${item.quantity}x ${item.product_name} (${item.weight}) - R$ ${item.price.toFixed(2)} cada`).join("\n");
  const emailBody = `
=== NOVO PEDIDO CONFIRMADO (PAGO VIA PIX PJ) ===
ID do Pedido: ${order.id}
Data: ${order.created_at}
Valor Total: R$ ${order.total.toFixed(2)}

DADOS DO CLIENTE:
Nome: ${order.client_name}
CPF: ${order.client_cpf}
E-mail: ${order.client_email}
Telefone: ${order.client_phone}
Endereço de Entrega: ${order.client_address}

ITENS DO PEDIDO:
${itemsText}

================================================
Status da Nota Fiscal: Pendente (Processando na SEFAZ...)
  `;
  console.log(emailBody);

  // Tenta enviar e-mail real se não estiver em modo de simulação
  if (!config.simulationMode && config.email.smtpUser !== "seu_email@gmail.com") {
    const nodemailer = require("nodemailer");
    const transporter = nodemailer.createTransport({
      host: config.email.smtpHost,
      port: config.email.smtpPort,
      secure: config.email.smtpPort === 465,
      auth: {
        user: config.email.smtpUser,
        pass: config.email.smtpPass
      }
    });

    transporter.sendMail({
      from: `"Catálogo Sabor da Terra" <${config.email.smtpUser}>`,
      to: config.email.notifyTo,
      subject: `🌿 Novo Pedido Confirmado! [${order.id}]`,
      text: emailBody
    }).then(() => {
      console.log("[E-MAIL] Notificação de e-mail enviada com sucesso!");
    }).catch(err => {
      console.error("[E-MAIL] Falha ao enviar e-mail real:", err.message);
    });
  } else {
    console.log("[E-MAIL] [SIMULAÇÃO] E-mail simulado com sucesso! (Nenhum e-mail real foi enviado)");
  }

  // 2. Simulação / Emissão de Nota Fiscal
  console.log(`[NOTA FISCAL] Iniciando comunicação com API SEFAZ/FocusNFe para emitir NFC-e do pedido ${order.id}...`);
  console.log(`[NOTA FISCAL] Enviando dados do CNPJ/CPF ${order.client_cpf} e valor de R$ ${order.total.toFixed(2)}...`);

  if (!config.simulationMode && config.focusNfe.token !== "SEU_FOCUS_NFE_TOKEN_AQUI") {
    // Código de Integração Real com FocusNFe (NFC-e)
    const https = require("https");
    // Dados da nota fiscal baseados nos produtos e cliente
    const invoicePayload = JSON.stringify({
      natureza_operacao: "Venda de mercadorias",
      regime_tributario: 1, // Simples Nacional (padrão MEI/ME)
      cnpj_emitente: "SEU_CNPJ_EMITENTE_AQUI", // Deve ser configurado
      presenca_comprador: 1, // Operação presencial / entrega
      modalidade_frete: 9, // Sem frete
      consumidor_final: 1,
      destinatario: {
        nome: order.client_name,
        cpf: order.client_cpf.replace(/[^\d]/g, ""),
        email: order.client_email,
        endereco: {
          logradouro: order.client_address.split(",")[0],
          numero: order.client_address.split(",")[1]?.split("-")[0]?.trim() || "S/N",
          bairro: order.client_address.split("-")[1]?.split(",")[0]?.trim() || "Centro",
          municipio: config.merchantCity,
          uf: "SP" // Padrão
        }
      },
      itens: items.map((item, index) => ({
        numero_item: index + 1,
        codigo_produto: item.product_id,
        descricao: item.product_name,
        cfop: "5102", // CFOP de venda de mercadorias
        unidade_comercial: "UN",
        quantidade_comercial: item.quantity,
        valor_unitario_comercial: item.price,
        valor_bruto: item.price * item.quantity,
        icoms_situacao_tributaria: "102" // Simples Nacional sem crédito
      }))
    });

    const isSandbox = config.focusNfe.sandbox;
    const hostname = isSandbox ? "homologacao.focusnfe.com.br" : "api.focusnfe.com.br";
    const path = "/v2/nfce";
    
    // Requisição para emissão de nota
    const mpOptions = {
      hostname,
      port: 443,
      path: `${path}?ref=${order.id}`,
      method: "POST",
      headers: {
        "Authorization": "Basic " + Buffer.from(config.focusNfe.token + ":").toString("base64"),
        "Content-Type": "application/json"
      }
    };

    const nfReq = https.request(mpOptions, (nfRes) => {
      let body = "";
      nfRes.on("data", (d) => body += d);
      nfRes.on("end", () => {
        try {
          const nfData = JSON.parse(body);
          if (nfRes.statusCode === 201 || nfRes.statusCode === 202) {
            // Nota enviada ou processando
            const invoiceId = nfData.chave_nfe || `NFE-${Date.now().toString().slice(-6)}`;
            db.run("UPDATE pedidos SET invoice_status = 'emitted', invoice_id = ? WHERE id = ?", [invoiceId, order.id], () => {
              console.log(`[NOTA FISCAL] Nota Fiscal emitida com sucesso! Chave: ${invoiceId}`);
            });
          } else {
            console.error("[NOTA FISCAL] Erro ao emitir Nota Fiscal na API:", nfData);
            db.run("UPDATE pedidos SET invoice_status = 'failed' WHERE id = ?", [order.id]);
          }
        } catch (e) {
          console.error("[NOTA FISCAL] Erro ao decodificar retorno de Nota Fiscal:", e);
        }
      });
    });
    nfReq.write(invoicePayload);
    nfReq.end();
  } else {
    // SIMULAÇÃO: Simula o processamento da Nota Fiscal e retorna sucesso após 2 segundos
    setTimeout(() => {
      const mockInvoiceId = `352606` + Math.floor(Math.random() * 90000000000000000000000000000000000000).toString().slice(0, 38);
      db.run("UPDATE pedidos SET invoice_status = 'emitted', invoice_id = ? WHERE id = ?", [mockInvoiceId, order.id], () => {
        console.log(`[NOTA FISCAL] [SIMULAÇÃO] Nota Fiscal emitida e salva! Chave: ${mockInvoiceId}`);
      });
    }, 2000);
  }
}

// Serve o painel Admin do site
app.get("/admin", (req, res) => {
  res.sendFile(path.join(__dirname, "admin.html"));
});

// API Rota: Listagem de todos os pedidos no banco (para o Painel Admin)
app.get("/api/admin/orders", (req, res) => {
  db.all("SELECT * FROM pedidos ORDER BY created_at DESC", [], (err, rows) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    res.json(rows);
  });
});

// Inicialização do Servidor
app.listen(PORT, () => {
  console.log(`====================================================`);
  console.log(`Servidor Sabor da Terra rodando na porta ${PORT}`);
  console.log(`Acesse o Catálogo em: http://localhost:${PORT}`);
  console.log(`Acesse o Painel Administrativo em: http://localhost:${PORT}/admin`);
  console.log(`====================================================`);
});
