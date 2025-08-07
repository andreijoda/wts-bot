import "dotenv/config.js";
import axios from "axios";
import qrcode from "qrcode-terminal";
import pkg from "whatsapp-web.js";
const { Client, LocalAuth } = pkg;

const {
  ML_ACCESS_TOKEN,
  ML_USER_ID,
  WHATSAPP_GROUP_ID
} = process.env;

let lastOrderDate = new Date(); // usado para não repetir vendas antigas

const client = new Client({
  authStrategy: new LocalAuth(),
  puppeteer: {
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  }
});

client.on("qr", (qr) => {
  qrcode.generate(qr, { small: true });
  console.log("Escaneie o QR Code com seu WhatsApp.");
});

client.on("ready", async () => {
  console.log("WhatsApp conectado!");
  setInterval(checkNewSales, 60 * 1000);
});

client.on('message_create', async (msg) => {
  const chat = await msg.getChat();

  if (msg.body === '!help') {
    await msg.reply('getvendas QUATIDADE - Ver Todas Vendas.');
    await msg.reply('vervenda #VENDA - Ver informações da venda.');
  }

  if (msg.body === '!getgrupo') {
    if (chat.isGroup) {
      await msg.reply(`ID deste grupo é: ${chat.id._serialized}`);
    } else {
      await msg.reply('Esse comando só funciona dentro de grupos.');
    }
  }

  if (msg.body.startsWith('!getvendas')) {
    if (!chat.isGroup) {
      await msg.reply('Esse comando só funciona dentro de grupos.');
      return;
    }

    const args = msg.body.split(' ');
    let limit = 5;
    if (args[1]) {
      const n = parseInt(args[1], 10);
      if (!isNaN(n) && n > 0) {
        limit = n;
      }
    }

    try {
      await msg.reply('Consultando vendas...');

      const apiUrl = `https://api.mercadolibre.com/orders/search?seller=${ML_USER_ID}&order.status=paid&access_token=${ML_ACCESS_TOKEN}`;
      const { data } = await axios.get(apiUrl);

      if (!data.results.length) {
        await msg.reply('Nenhuma venda encontrada.');
        return;
      }

      const ultimas = data.results.slice().reverse().slice(0, limit);
      let texto = '*Últimas vendas:*\n\n';

      for (const order of ultimas) {
        const produto = order.order_items[0].item.title;
        const numeroPedido = order.id;
        const dataVenda = new Date(order.date_created).toLocaleString('pt-BR');
        texto += `📍Produto: ${produto}\n  🆔Pedido: #${numeroPedido}\n  🗓️Data: ${dataVenda}\n\n`;
      }

      await msg.reply(texto.trim());
    } catch (err) {
      console.error("Erro ao consultar vendas:", err.message);
      await msg.reply('Erro ao consultar vendas.');
    }
  }

  if (msg.body.startsWith('!vervenda ')) {
    const numero = msg.body.split(' ')[1];

    if (!numero) {
      await msg.reply('Uso correto: !vervenda NUMEROPEDIDO');
      return;
    }

    await msg.reply('Buscando dados da venda...');
    try {
      const url = `https://api.mercadolibre.com/orders/${numero}?access_token=${ML_ACCESS_TOKEN}`;
      const { data: order } = await axios.get(url);

      const item = order.order_items[0].item.title;
      const variacao = order.order_items[0].item.variation_attributes?.map(v => v.value_name).join(" / ") || "-";
      const qtd = order.order_items[0].quantity;
      const preco = order.order_items[0].unit_price;
      const total = order.total_amount;
      const cliente = order.buyer.nickname || order.buyer.first_name || "Desconhecido";
      const dataVenda = new Date(order.date_created).toLocaleString('pt-BR');

      // Verifica o método de envio
      let metodoEnvio = "desconhecido";
      const shipmentId = order.shipping?.id;
      if (shipmentId) {
        try {
          const shipUrl = `https://api.mercadolibre.com/shipments/${shipmentId}?access_token=${ML_ACCESS_TOKEN}`;
          const { data: shipping } = await axios.get(shipUrl);
          const tipo = shipping.logistic_type;
          if (tipo === "self_service") {
            metodoEnvio = "Flex (envio no mesmo dia)";
          } else if (tipo === "drop_off") {
            metodoEnvio = "Agência";
          } else {
            metodoEnvio = tipo;
          }
        } catch (err) {
          console.error("Erro ao buscar método de envio:", err.message);
        }
      }

      const texto =
`👀 *Visualizando Venda*

📦 Produto: ${item}
🎨 Variação: ${variacao}
🔢 Quantidade: ${qtd}

💵 Preço unitário: R$ ${preco.toFixed(2)}
💰 Valor total: R$ ${total.toFixed(2)}

🚚 Envio: ${metodoEnvio}
👤 Comprador: ${cliente}

📝 Pedido: #${numero}
📅 Data da venda: ${dataVenda}`;

      await msg.reply(texto);
    } catch (err) {
      console.log("Erro ao buscar pedido:", err.message);
      await msg.reply('Erro ao consultar este pedido. Verifique se o número está correto.');
    }
  }
});

client.initialize();

async function checkNewSales() {
  try {
    const apiUrl = `https://api.mercadolibre.com/orders/search?seller=${ML_USER_ID}&order.status=paid&access_token=${ML_ACCESS_TOKEN}`;
    const { data } = await axios.get(apiUrl);

    for (const order of data.results) {
      const orderDate = new Date(order.date_created);
      if (orderDate > lastOrderDate) {
        lastOrderDate = orderDate;

        const produto = order.order_items[0].item.title;
        const variacao = order.order_items[0].item.variation_attributes?.map(v => v.value_name).join(" / ") || "-";

        // Verifica método de envio
        let metodoEnvio = "desconhecido";
        const shipmentId = order.shipping?.id;
        if (shipmentId) {
          try {
            const shipUrl = `https://api.mercadolibre.com/shipments/${shipmentId}?access_token=${ML_ACCESS_TOKEN}`;
            const { data: shipping } = await axios.get(shipUrl);
            const tipo = shipping.logistic_type;
            if (tipo === "self_service") {
            metodoEnvio = "Flex (envio no mesmo dia)";
          } else if (tipo === "drop_off") {
            metodoEnvio = "Agência";
          } else {
            metodoEnvio = tipo;
          }
          } catch (err) {
            console.error("Erro ao buscar método de envio (notificação):", err.message);
          }
        }

        await notifyWhatsapp(produto, variacao, metodoEnvio);
      }
    }
  } catch (err) {
    console.error("Erro ao consultar API ML:", err.message);
  }
}

async function notifyWhatsapp(produto, variacao, metodoEnvio) {
  try {
    const chat = await client.getChatById(WHATSAPP_GROUP_ID);
    const msg = `📦 Você vendeu! ${produto} (${variacao})\n🚚 Envio: ${metodoEnvio}`;
    await chat.sendMessage(msg);
    console.log("Mensagem enviada:", msg);
  } catch (err) {
    console.log("Erro ao enviar mensagem: ", err.message);
  }
}
