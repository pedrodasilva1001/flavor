import http.server
import socketserver
import json
import urllib.parse
import sqlite3
import os
import random
import time
from datetime import datetime

# Importa de forma segura o driver PostgreSQL
try:
    import psycopg2
    HAS_PG = True
except ImportError:
    HAS_PG = False

PORT = int(os.environ.get("PORT", 8000))
DB_FILE = "database.db"
DATABASE_URL = os.environ.get("DATABASE_URL")

# --- CONEXÃO E ABSTRAÇÃO DE BANCO DE DADOS ---

def get_db_connection():
    if DATABASE_URL and HAS_PG:
        try:
            url = DATABASE_URL
            # Garante sslmode=require para evitar rejeição por falta de SSL no Supabase/Neon
            if "sslmode=" not in url:
                if "?" in url:
                    url += "&sslmode=require"
                else:
                    url += "?sslmode=require"
            conn = psycopg2.connect(url)
            return conn, True
        except Exception as e:
            print("Erro ao conectar ao PostgreSQL, usando SQLite local:", e)
    
    conn = sqlite3.connect(DB_FILE)
    return conn, False

# Inicializa o Banco de Dados
def init_db():
    conn, is_pg = get_db_connection()
    cursor = conn.cursor()
    
    # Cria tabela de pedidos
    cursor.execute("""
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
    """)
    
    # Cria tabela de itens
    # SERIAL no Postgres, AUTOINCREMENT no SQLite
    item_pk = "id SERIAL PRIMARY KEY" if is_pg else "id INTEGER PRIMARY KEY AUTOINCREMENT"
    
    cursor.execute(f"""
        CREATE TABLE IF NOT EXISTS itens_pedido (
            {item_pk},
            order_id VARCHAR(50),
            product_id VARCHAR(50),
            product_name VARCHAR(150),
            weight VARCHAR(20),
            quantity INTEGER,
            price REAL,
            FOREIGN KEY(order_id) REFERENCES pedidos(id)
        )
    """)
    
    conn.commit()
    conn.close()
    print(f"Banco de dados inicializado. Tipo: {'PostgreSQL (Nuvem)' if is_pg else 'SQLite (Local)'}")

# Helper para consultas do tipo SELECT
def query_db(query, args=(), one=False):
    conn, is_pg = get_db_connection()
    cursor = conn.cursor()
    
    if is_pg:
        # Substitui ? por %s para compatibilidade com o psycopg2
        query = query.replace("?", "%s")
        
    cursor.execute(query, args)
    
    # Transforma o resultado em lista de dicionários
    columns = [col[0] for col in cursor.description]
    rows = cursor.fetchall()
    cursor.close()
    conn.close()
    
    result = [dict(zip(columns, row)) for row in rows]
    return (result[0] if result else None) if one else result

# Helper para salvar pedidos e itens em uma única transação
def save_order_and_items(order_data, items_data):
    conn, is_pg = get_db_connection()
    cursor = conn.cursor()
    try:
        order_query = """
            INSERT INTO pedidos (id, client_name, client_cpf, client_email, client_phone, client_zip, client_address, total, status, pix_code, invoice_status, invoice_id, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """
        if is_pg:
            order_query = order_query.replace("?", "%s")
        cursor.execute(order_query, order_data)
        
        item_query = """
            INSERT INTO itens_pedido (order_id, product_id, product_name, weight, quantity, price)
            VALUES (?, ?, ?, ?, ?, ?)
        """
        if is_pg:
            item_query = item_query.replace("?", "%s")
            
        for item in items_data:
            cursor.execute(item_query, item)
            
        conn.commit()
    except Exception as e:
        conn.rollback()
        raise e
    finally:
        cursor.close()
        conn.close()

# Helper para atualizar status simples
def update_db(query, args=()):
    conn, is_pg = get_db_connection()
    cursor = conn.cursor()
    try:
        if is_pg:
            query = query.replace("?", "%s")
        cursor.execute(query, args)
        conn.commit()
    finally:
        cursor.close()
        conn.close()

# Inicializa o Banco
init_db()

# --- AUXILIAR: Gerador de BR Code Pix Estático (Valor Dinâmico) ---
def generate_pix_brcode(pix_key, amount, merchant_name, merchant_city):
    clean_key = urllib.parse.quote(pix_key.strip())
    clean_name = merchant_name[:25].upper()
    clean_city = merchant_city[:15].upper()
    clean_amount = f"{float(amount):.2f}"

    def format_field(id_str, val):
        length = f"{len(val):02d}"
        return f"{id_str}{length}{val}"

    merchant_account_info = format_field("00", "br.gov.bcb.pix") + format_field("01", pix_key)

    payload = (
        format_field("00", "01") +
        format_field("26", merchant_account_info) +
        format_field("52", "0000") +
        format_field("53", "986") +
        format_field("54", clean_amount) +
        format_field("58", "BR") +
        format_field("59", clean_name) +
        format_field("60", clean_city) +
        format_field("62", format_field("05", "ST0001"))
    )

    payload_with_crc = payload + "6304"
    
    # Cálculo CRC16 CCITT
    crc = 0xFFFF
    for char in payload_with_crc:
        crc ^= ord(char) << 8
        for _ in range(8):
            if crc & 0x8000:
                crc = (crc << 1) ^ 0x1021
            else:
                crc = crc << 1
    crc_hex = f"{crc & 0xFFFF:04X}"
    return payload_with_crc + crc_hex

# Processador de Automacoes (Simulacao)
def run_automations(order_id, client_name, client_cpf, client_email, total, items_text):
    print(f"\n--- INICIANDO AUTOMATIZAÇÕES PARA O PEDIDO {order_id} ---")
    print(f"[E-MAIL] Notificação enviada para: sabordaterravls@gmail.com")
    email_body = f"""
=== NOVO PEDIDO CONFIRMADO (PAGO VIA PIX PJ) ===
ID do Pedido: {order_id}
Valor Total: R$ {total:.2f}

DADOS DO CLIENTE:
Nome: {client_name}
CPF: {client_cpf}
E-mail: {client_email}

ITENS DO PEDIDO:
{items_text}
================================================
"""
    print(email_body)

    # Simula emissão de nota na SEFAZ após 2 segundos
    def emit_invoice():
        mock_invoice_id = "352606" + "".join([str(random.randint(0, 9)) for _ in range(38)])
        update_db("UPDATE pedidos SET invoice_status = 'emitted', invoice_id = ? WHERE id = ?", (mock_invoice_id, order_id))
        print(f"[NOTA FISCAL] [SIMULAÇÃO] Nota Fiscal emitida e salva! Chave: ${mock_invoice_id}")
    
    emit_invoice()

# Request Handler customizado
class CustomHandler(http.server.SimpleHTTPRequestHandler):
    def check_auth(self):
        import base64
        auth_header = self.headers.get('Authorization')
        # Pega do ambiente ou usa padrão sabor123 para testes
        admin_user = os.environ.get("ADMIN_USER", "Flavor97970515")
        admin_pass = os.environ.get("ADMIN_PASS", "winS4IDAQUI2010!#")
        expected_auth = "Basic " + base64.b64encode(f"{admin_user}:{admin_pass}".encode("utf-8")).decode("utf-8")
        
        if auth_header == expected_auth:
            return True
            
        self.send_response(401)
        self.send_header('WWW-Authenticate', 'Basic realm="Admin Sabor da Terra"')
        self.send_header('Content-Type', 'text/html; charset=utf-8')
        self.end_headers()
        self.wfile.write("<h1>Acesso Negado</h1><p>Usuário ou senha incorretos.</p>".encode("utf-8"))
        return False

    def end_headers(self):
        # Permite CORS
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(200, "ok")
        self.end_headers()

    def do_GET(self):
        # Rota: Painel Admin HTML
        if self.path == "/admin" or self.path == "/admin.html":
            if not self.check_auth():
                return
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.end_headers()
            with open("admin.html", "rb") as f:
                self.wfile.write(f.read())
            return

        # Rota: API - Lista pedidos no Admin
        if self.path == "/api/admin/orders":
            if not self.check_auth():
                return
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            
            orders = query_db("SELECT * FROM pedidos ORDER BY created_at DESC")
            for order in orders:
                items = query_db("SELECT product_name, weight, quantity, price FROM itens_pedido WHERE order_id = ?", (order["id"],))
                order["items"] = items
                
            self.wfile.write(json.dumps(orders).encode("utf-8"))
            return

        # Rota: API - Status de Pedido
        if self.path.startswith("/api/order/status/"):
            order_id = self.path.split("/")[-1]
            row = query_db("SELECT status, invoice_status, invoice_id FROM pedidos WHERE id = ?", (order_id,), one=True)

            if row:
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(json.dumps(row).encode("utf-8"))
            else:
                self.send_response(404)
                self.end_headers()
            return

        # Fallback para arquivos estáticos
        super().do_GET()

    def do_POST(self):
        # Rota: API - Checkout (Cria pedido e gera Pix)
        if self.path == "/api/checkout":
            content_length = int(self.headers['Content-Length'])
            post_data = self.rfile.read(content_length)
            data = json.loads(post_data.decode('utf-8'))

            client = data.get("client")
            cart = data.get("cart")

            if not client or not cart:
                self.send_response(400)
                self.end_headers()
                self.wfile.write(json.dumps({"error": "Dados inválidos."}).encode("utf-8"))
                return

            # Gera ID e calcula total
            order_id = f"ST-{str(int(time.time()))[-6:]}-{random.randint(100, 999)}"
            total = sum(item["price"] * item["quantity"] for item in cart)
            
            # Carrega config do config.json / Variaveis de ambiente
            pix_key = os.environ.get("PIX_KEY", "sabordaterravls@gmail.com")
            m_name = os.environ.get("MERCHANT_NAME", "Sabor da Terra")
            m_city = os.environ.get("MERCHANT_CITY", "Valinhos")
            if os.path.exists("config.json"):
                try:
                    with open("config.json", "r") as f:
                        cfg = json.load(f)
                        if "PIX_KEY" not in os.environ:
                            pix_key = cfg.get("pixKey", pix_key)
                        if "MERCHANT_NAME" not in os.environ:
                            m_name = cfg.get("merchantName", m_name)
                        if "MERCHANT_CITY" not in os.environ:
                            m_city = cfg.get("merchantCity", m_city)
                except Exception:
                    pass

            # Gera Pix
            pix_code = generate_pix_brcode(pix_key, total, m_name, m_city)
            qr_code_url = f"https://api.qrserver.com/v1/create-qr-code/?size=250x250&data={urllib.parse.quote(pix_code)}"

            # Salva no Banco de Dados (Transação Unificada)
            created_at = datetime.utcnow().isoformat()
            full_address = f"{client['street']}, {client['number']} - {client['neighborhood']}, {client['city']}"
            
            order_data = (
                order_id, client["name"], client["cpf"], client["email"], client["phone"], client["zip"],
                full_address, total, "pending", pix_code, "pending", "", created_at
            )
            
            items_data = [
                (order_id, item["id"], item["name"], item["weight"], item["quantity"], item["price"])
                for item in cart
            ]
            
            try:
                save_order_and_items(order_data, items_data)
            except Exception as e:
                print("Erro ao salvar pedido no banco de dados:", e)
                self.send_response(500)
                self.end_headers()
                self.wfile.write(json.dumps({"error": "Erro interno ao registrar pedido."}).encode("utf-8"))
                return

            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            response_payload = {
                "orderId": order_id,
                "total": total,
                "pixCode": pix_code,
                "qrCodeUrl": qr_code_url,
                "status": "pending"
            }
            self.wfile.write(json.dumps(response_payload).encode("utf-8"))
            return

        # Rota: API - Simular Confirmação de Pagamento
        if self.path.startswith("/api/simulate-payment/"):
            order_id = self.path.split("/")[-1]
            
            order = query_db("SELECT * FROM pedidos WHERE id = ?", (order_id,), one=True)
            
            if not order:
                self.send_response(404)
                self.end_headers()
                return

            if order["status"] == "paid":
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(json.dumps({"message": "Pedido já pago."}).encode("utf-8"))
                return

            # Atualiza para pago
            update_db("UPDATE pedidos SET status = 'paid' WHERE id = ?", (order_id,))
            
            # Pega itens para log
            items = query_db("SELECT * FROM itens_pedido WHERE order_id = ?", (order_id,))

            # Executa as automações
            items_text = "\n".join([f"  - {item['quantity']}x {item['product_name']} ({item['weight']}) - R$ {item['price']:.2f}" for item in items])
            run_automations(order_id, order["client_name"], order["client_cpf"], order["client_email"], order["total"], items_text)

            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({
                "message": "Pagamento simulado com sucesso!",
                "orderId": order_id,
                "status": "paid"
            }).encode("utf-8"))
            return

        self.send_response(404)
        self.end_headers()

# Roda o servidor
def run():
    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.TCPServer(("", PORT), CustomHandler) as httpd:
        print(f"====================================================")
        print(f"Servidor Sabor da Terra (Python) ativo na porta {PORT}")
        print(f"Abra no seu navegador: http://localhost:{PORT}")
        print(f"Acesse o Painel Admin em: http://localhost:{PORT}/admin")
        print(f"====================================================")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            pass

if __name__ == "__main__":
    run()
