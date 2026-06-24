const express = require("express");
const cors = require("cors");
const path = require("path");
const fs = require("fs");
const { Pool } = require("pg");
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

// --- CONFIGURAÇÃO E CONEXÃO DO BANCO DE DADOS ---
const DATABASE_URL = process.env.DATABASE_URL;
let pgPool = null;
let sqliteDb = null;
let isPg = false;

if (DATABASE_URL) {
  try {
    let url = DATABASE_URL;
    // Garante sslmode=require para evitar rejeição por falta de SSL no Supabase
    if (!url.includes("sslmode=")) {
      url += url.includes("?") ? "&sslmode=require" : "?sslmode=require";
    }
    pgPool = new Pool({
      connectionString: url,
      ssl: {
        rejectUnauthorized: false
      }
    });
    isPg = true;
    console.log("PostgreSQL/Supabase configurado como banco principal.");
  } catch (err) {
    console.error("Erro ao configurar PostgreSQL, usando SQLite local:", err);
    isPg = false;
  }
}

// Inicialização do Banco
function initDatabase() {
  const queryPedidos = `
    CREATE TABLE IF NOT EXISTS pedidos (
      id VARCHAR(50) PRIMARY KEY,
      client_name VARCHAR(150),
      client_cpf VARCHAR(20),
      client_email VARCHAR(100),
      client_phone VARCHAR(20),
      client_zip VARCHAR(20),
      client_address TEXT,
      total REAL,
      status VARCHAR(20),
      pix_code TEXT,
      invoice_status VARCHAR(20),
      invoice_id TEXT,
      created_at VARCHAR(50)
    )
  `;

  const itemPk = isPg ? "id SERIAL PRIMARY KEY" : "id INTEGER PRIMARY KEY AUTOINCREMENT";
  const queryItens = `
    CREATE TABLE IF NOT EXISTS itens_pedido (
      ${itemPk},
      order_id VARCHAR(50),
      product_id VARCHAR(50),
      product_name VARCHAR(150),
      weight VARCHAR(20),
      quantity INTEGER,
      price REAL,
      FOREIGN KEY(order_id) REFERENCES pedidos(id)
    )
  `;

  if (isPg) {
    pgPool.query(queryPedidos)
      .then(() => pgPool.query(queryItens))
      .then(() => {
        console.log("Banco de dados PostgreSQL (Supabase) inicializado com sucesso!");
      })
      .catch((err) => {
        console.error("Erro ao inicializar tabelas no PostgreSQL, tentando fallback para SQLite:", err);
        isPg = false;
        fallbackToSQLite();
      });
  } else {
    fallbackToSQLite();
  }

  function fallbackToSQLite() {
    const dbPath = path.join(__dirname, "database.db");
    sqliteDb = new sqlite3.Database(dbPath, (err) => {
      if (err) {
        console.error("Erro ao conectar no banco de dados SQLite:", err);
      } else {
        sqliteDb.serialize(() => {
          sqliteDb.run(queryPedidos);
          sqliteDb.run(queryItens, (err) => {
            if (!err) {
              console.log("Banco de dados SQLite (Local) inicializado com sucesso!");
            } else {
              console.error("Erro ao criar tabelas no SQLite:", err);
            }
          });
        });
      }
    });
  }
}

// Inicializa o banco de dados
initDatabase();

// --- ABSTRAÇÃO E HELPERS DE CONSULTA SQL ---

// Converte placeholders ? do SQLite para $1, $2, ... do PostgreSQL
function convertPlaceholders(sql) {
  if (!isPg) return sql;
  let index = 1;
  return sql.replace(/\?/g, () => `$${index++}`);
}

async function runQuery(sql, params = []) {
  const queryStr = convertPlaceholders(sql);
  if (isPg) {
    await pgPool.query(queryStr, params);
  } else {
    return new Promise((resolve, reject) => {
      sqliteDb.run(queryStr, params, function (err) {
        if (err) reject(err);
        else resolve(this);
      });
    });
  }
}

async function getRow(sql, params = []) {
  const queryStr = convertPlaceholders(sql);
  if (isPg) {
    const res = await pgPool.query(queryStr, params);
    return res.rows[0] || null;
  } else {
    return new Promise((resolve, reject) => {
      sqliteDb.get(queryStr, params, (err, row) => {
        if (err) reject(err);
        else resolve(row || null);
      });
    });
  }
}

async function getAllRows(sql, params = []) {
  const queryStr = convertPlaceholders(sql);
  if (isPg) {
    const res = await pgPool.query(queryStr, params);
    return res.rows;
  } else {
    return new Promise((resolve, reject) => {
      sqliteDb.all(queryStr, params, (err, rows) => {
        if (err) reject(err);
        else resolve(rows || []);
      });
    });
  }
}

async function saveOrderAndItems(orderParams, items) {
  if (isPg) {
    const client = await pgPool.connect();
    try {
      await client.query("BEGIN");
      const orderSql = convertPlaceholders(`
        INSERT INTO pedidos (id, client_name, client_cpf, client_email, client_phone, client_zip, client_address, total, status, pix_code, invoice_status, invoice_id, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      await client.query(orderSql, orderParams);

      const itemSql = convertPlaceholders(`
        INSERT INTO itens_pedido (order_id, product_id, product_name, weight, quantity, price)
        VALUES (?, ?, ?, ?, ?, ?)
      `);
      for (const item of items) {
        await client.query(itemSql, item);
      }
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  } else {
    return new Promise((resolve, reject) => {
      sqliteDb.serialize(() => {
        sqliteDb.run("BEGIN TRANSACTION");
        
        sqliteDb.run(
          `INSERT INTO pedidos (id, client_name, client_cpf, client_email, client_phone, client_zip, client_address, total, status, pix_code, invoice_status, invoice_id, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          , orderParams, function(err) {
            if (err) {
              sqliteDb.run("ROLLBACK");
              return reject(err);
            }
            
            const stmt = sqliteDb.prepare(`
              INSERT INTO itens_pedido (order_id, product_id, product_name, weight, quantity, price)
              VALUES (?, ?, ?, ?, ?, ?)
            `);
            
            let itemErr = null;
            for (const item of items) {
              stmt.run(item, (err) => {
                if (err) itemErr = err;
              });
            }
            
            stmt.finalize((err) => {
              if (err || itemErr) {
                sqliteDb.run("ROLLBACK");
                return reject(err || itemErr);
              }
              sqliteDb.run("COMMIT", (err) => {
                if (err) reject(err);
                else resolve();
              });
            });
          }
        );
      });
    });
  }
}

// --- MIDDLEWARE DE AUTENTICAÇÃO BÁSICA ---
const checkAuth = (req, res, next) => {
  const authHeader = req.headers.authorization;
  const adminUser = process.env.ADMIN_USER || "Flavor97970515";
  const adminPass = process.env.ADMIN_PASS || "winS4IDAQUI2010!#";
  
  const expectedAuth = "Basic " + Buffer.from(`${adminUser}:${adminPass}`).toString("base64");
  
  if (authHeader === expectedAuth) {
    return next();
  }
  
  res.setHeader("WWW-Authenticate", 'Basic realm="Admin Sabor da Terra"');
  res.status(401).send("<h1>Acesso Negado</h1><p>Usuário ou senha incorretos.</p>");
};

// --- AUXILIAR: Gerador de BR Code Pix Estático (Valor Dinâmico) ---
function generateBRCode(pixKey, amount, merchantName, merchantCity) {
  const cleanKey = pixKey.replace(/[^\w@.-]/g, "");
  const cleanName = merchantName.substring(0, 25).toUpperCase();
  const cleanCity = merchantCity.substring(0, 15).toUpperCase();
  const cleanAmount = parseFloat(amount).toFixed(2);

  const formatField = (id, val) => {
    const len = val.length.toString().padStart(2, "0");
    return `${id}${len}${val}`;
  };

  const merchantAccountInfo = formatField("00", "br.gov.bcb.pix") + formatField("01", cleanKey);

  const payload = [
    formatField("00", "01"),
    formatField("26", merchantAccountInfo),
    formatField("52", "0000"),
    formatField("53", "986"),
    formatField("54", cleanAmount),
    formatField("58", "BR"),
    formatField("59", cleanName),
    formatField("60", cleanCity),
    formatField("62", formatField("05", "ST0001"))
  ].join("");

  const payloadWithCrcPlaceholder = payload + "6304";
  
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

  const orderId = `ST-${Date.now().toString().slice(-6)}-${Math.floor(Math.random() * 1000)}`;
  
  let total = 0;
  cart.forEach(item => {
    total += item.price * item.quantity;
  });

  const createdAt = new Date().toISOString();
  let pixCode = "";
  let qrCodeUrl = "";

  if (config.simulationMode) {
    pixCode = generateBRCode(config.pixKey, total, config.merchantName, config.merchantCity);
    qrCodeUrl = `https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${encodeURIComponent(pixCode)}`;
    saveOrder();
  } else {
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

  async function saveOrder() {
    try {
      const orderParams = [
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
      ];

      const items = cart.map(item => [
        orderId,
        item.id,
        item.name,
        item.weight,
        item.quantity,
        item.price
      ]);

      await saveOrderAndItems(orderParams, items);

      res.json({
        orderId,
        total,
        pixCode,
        qrCodeUrl,
        status: "pending"
      });
    } catch (err) {
      console.error("Erro ao salvar pedido no banco de dados:", err);
      res.status(500).json({ error: "Erro interno ao registrar pedido." });
    }
  }
});

// Rota 2: Verifica status do pedido (usado por Polling na tela)
app.get("/api/order/status/:id", async (req, res) => {
  const orderId = req.params.id;
  try {
    const row = await getRow("SELECT status, invoice_status, invoice_id FROM pedidos WHERE id = ?", [orderId]);
    if (!row) {
      return res.status(404).json({ error: "Pedido não encontrado." });
    }
    res.json(row);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao consultar status." });
  }
});

// Rota 3: Simulador de Confirmação de Pagamento (Developer/Test Tool)
app.post("/api/simulate-payment/:id", async (req, res) => {
  const orderId = req.params.id;
  try {
    const order = await getRow("SELECT * FROM pedidos WHERE id = ?", [orderId]);
    if (!order) {
      return res.status(404).json({ error: "Pedido não encontrado para simulação." });
    }

    if (order.status === "paid") {
      return res.json({ message: "Pedido já estava pago.", order });
    }

    await runQuery("UPDATE pedidos SET status = 'paid' WHERE id = ?", [orderId]);
    const items = await getAllRows("SELECT * FROM itens_pedido WHERE order_id = ?", [orderId]);
    
    // Dispara as automações assincronamente (E-mail + Nota Fiscal)
    processAutomations(order, items);
    
    res.json({
      message: "Pagamento simulado com sucesso!",
      orderId,
      status: "paid"
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao processar simulação de pagamento." });
  }
});

// Rota 4: Webhook real do intermediador (Mercado Pago)
app.post("/api/webhooks/payment", (req, res) => {
  res.sendStatus(200);

  const payload = req.body;
  console.log("Webhook recebido:", payload);

  if (payload.type === "payment" && payload.data && payload.data.id) {
    const paymentId = payload.data.id;
    
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
      mpRes.on("end", async () => {
        try {
          const paymentData = JSON.parse(body);
          if (paymentData.status === "approved") {
            const externalRef = paymentData.external_reference;
            const qrCode = paymentData.point_of_interaction?.transaction_data?.qr_code;
            
            const order = await getRow("SELECT * FROM pedidos WHERE id = ? OR pix_code = ?", [externalRef, qrCode]);
            if (order && order.status === "pending") {
              await runQuery("UPDATE pedidos SET status = 'paid' WHERE id = ?", [order.id]);
              const items = await getAllRows("SELECT * FROM itens_pedido WHERE order_id = ?", [order.id]);
              processAutomations(order, items);
            }
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

  // 1. Envio do E-mail para a Empresa
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

  // 2. Emissão de Nota Fiscal
  console.log(`[NOTA FISCAL] Iniciando comunicação com API SEFAZ/FocusNFe para emitir NFC-e do pedido ${order.id}...`);

  if (!config.simulationMode && config.focusNfe.token !== "SEU_FOCUS_NFE_TOKEN_AQUI") {
    const https = require("https");
    const invoicePayload = JSON.stringify({
      natureza_operacao: "Venda de mercadorias",
      regime_tributario: 1,
      cnpj_emitente: "SEU_CNPJ_EMITENTE_AQUI",
      presenca_comprador: 1,
      modalidade_frete: 9,
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
          uf: "SP"
        }
      },
      itens: items.map((item, index) => ({
        numero_item: index + 1,
        codigo_produto: item.product_id,
        descricao: item.product_name,
        cfop: "5102",
        unidade_comercial: "UN",
        quantidade_comercial: item.quantity,
        valor_unitario_comercial: item.price,
        valor_bruto: item.price * item.quantity,
        icoms_situacao_tributaria: "102"
      }))
    });

    const isSandbox = config.focusNfe.sandbox;
    const hostname = isSandbox ? "homologacao.focusnfe.com.br" : "api.focusnfe.com.br";
    const path = "/v2/nfce";
    
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
            const invoiceId = nfData.chave_nfe || `NFE-${Date.now().toString().slice(-6)}`;
            runQuery("UPDATE pedidos SET invoice_status = 'emitted', invoice_id = ? WHERE id = ?", [invoiceId, order.id])
              .then(() => console.log(`[NOTA FISCAL] Nota Fiscal emitida com sucesso! Chave: ${invoiceId}`))
              .catch(err => console.error("Erro ao atualizar NF:", err));
          } else {
            console.error("[NOTA FISCAL] Erro ao emitir Nota Fiscal na API:", nfData);
            runQuery("UPDATE pedidos SET invoice_status = 'failed' WHERE id = ?", [order.id])
              .catch(err => console.error("Erro ao atualizar NF falha:", err));
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
      runQuery("UPDATE pedidos SET invoice_status = 'emitted', invoice_id = ? WHERE id = ?", [mockInvoiceId, order.id])
        .then(() => console.log(`[NOTA FISCAL] [SIMULAÇÃO] Nota Fiscal emitida e salva! Chave: ${mockInvoiceId}`))
        .catch(err => console.error("Erro ao salvar NF simulada:", err));
    }, 2000);
  }
}

// Serve o painel Admin do site (protegido por Basic Auth)
app.get("/admin", checkAuth, (req, res) => {
  res.sendFile(path.join(__dirname, "admin.html"));
});

app.get("/admin.html", checkAuth, (req, res) => {
  res.sendFile(path.join(__dirname, "admin.html"));
});

// API Rota: Listagem de todos os pedidos no banco (para o Painel Admin - protegido por Basic Auth)
app.get("/api/admin/orders", checkAuth, async (req, res) => {
  try {
    const orders = await getAllRows("SELECT * FROM pedidos ORDER BY created_at DESC");
    for (const order of orders) {
      const items = await getAllRows("SELECT product_name, weight, quantity, price FROM itens_pedido WHERE order_id = ?", [order.id]);
      order.items = items;
    }
    res.json(orders);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// Inicialização do Servidor
app.listen(PORT, () => {
  console.log(`====================================================`);
  console.log(`Servidor Sabor da Terra rodando na porta ${PORT}`);
  console.log(`Acesse o Catálogo em: http://localhost:${PORT}`);
  console.log(`Acesse o Painel Administrativo em: http://localhost:${PORT}/admin`);
  console.log(`====================================================`);
});
