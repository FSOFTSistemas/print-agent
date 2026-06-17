const express = require("express");
const cors = require("cors");
const escpos = require("escpos");
escpos.USB = require("escpos-usb");

const app = express();
const PORT = 9100;

app.use(express.json({ limit: "5mb" }));
app.use(cors());

// Rota para verificar se o agente está online
app.get("/status", (req, res) => {
  res.json({
    status: "online",
    message: "Print Agent (Modo Ponte Universal) está rodando.",
  });
});

// FUNÇÃO HELPER para transformar o callback em Promise
function getStringDescriptorAsync(device, descriptorIndex) {
  return new Promise((resolve, reject) => {
    try {
      device.getStringDescriptor(descriptorIndex, (error, data) => {
        if (error) {
          return reject(error);
        }
        resolve(data);
      });
    } catch (error) {
      reject(error);
    }
  });
}

// Rota para listar impressoras
app.get("/printers", async (req, res) => {
  try {
    const devices = escpos.USB.findPrinter();
    const printerList = [];

    for (const device of devices) {
      let name = "Dispositivo USB Genérico";
      let manufacturer = "Fabricante Desconhecido";

      try {
        device.open();

        if (device.deviceDescriptor.iProduct > 0) {
          const rawName = await getStringDescriptorAsync(
            device,
            device.deviceDescriptor.iProduct
          );
          // AQUI ESTÁ A CORREÇÃO: Limpa a string de caracteres nulos e espaços
          name = rawName.replace(/\0/g, "").trim();
        }
        if (device.deviceDescriptor.iManufacturer > 0) {
          const rawManufacturer = await getStringDescriptorAsync(
            device,
            device.deviceDescriptor.iManufacturer
          );
          // AQUI ESTÁ A CORREÇÃO: Limpa a string de caracteres nulos e espaços
          manufacturer = rawManufacturer.replace(/\0/g, "").trim();
        }
      } catch (e) {
        console.warn(
          `Aviso: Não foi possível ler os detalhes do dispositivo. Erro: ${e.message}`
        );
      } finally {
        if (device.isOpen) {
          device.close();
        }
      }

      printerList.push({
        name,
        manufacturer,
        vid: `0x${device.deviceDescriptor.idVendor.toString(16)}`,
        pid: `0x${device.deviceDescriptor.idProduct.toString(16)}`,
        deviceAddress: device.deviceAddress,
      });
    }

    res.json(printerList);
  } catch (error) {
    console.error("Erro ao buscar impressoras:", error);
    res
      .status(500)
      .json({ error: "Falha ao listar impressoras.", details: error.message });
  }
});

// Rota principal que recebe os comandos e o ID da impressora
app.post("/print/raw-buffer", (req, res) => {
  try {
    const { bufferB64, printer } = req.body;
    if (!bufferB64) {
      return res.status(400).json({
        error: "É necessário enviar o 'bufferB64' no corpo da requisição.",
      });
    }
    if (!printer || !printer.vid || !printer.pid) {
      return res.status(400).json({
        error:
          "É necessário enviar o objeto 'printer' com 'vid' e 'pid' para identificar a impressora.",
      });
    }

    const printBuffer = Buffer.from(bufferB64, "base64");
    const vid = parseInt(printer.vid);
    const pid = parseInt(printer.pid);
    const device = new escpos.USB(vid, pid);

    if (!device) {
      return res.status(404).json({ error: "Impressora não encontrada." });
    }

    device.open((error) => {
      if (error) {
        console.error("Erro ao conectar na impressora USB:", error);
        return res.status(500).json({
          error: "Falha ao conectar com a impressora USB.",
          details: error.message,
        });
      }

      device.write(printBuffer, (err) => {
        if (err) {
          console.error("Erro ao enviar dados para a impressora:", err);
          res.status(500).json({
            error: "Falha ao escrever na impressora.",
            details: err.message,
          });
        } else {
          res.json({
            success: true,
            message: "Dados brutos enviados para a impressora.",
          });
        }
        device.close();
      });
    });
  } catch (err) {
    console.error("Erro geral na rota /print/raw-buffer:", err);
    res.status(500).json({
      error: "Ocorreu um erro inesperado no agente.",
      details: err.message,
    });
  }
});

// Inicia o servidor
app.listen(PORT, "0.0.0.0", () => {
  console.log(`=================================================`);
  console.log(`✅ Print Agent 2.0 (Ponte Universal) iniciado!`);
  console.log(`👂 Escutando em: http://localhost:${PORT}`);
  console.log(`   - GET /status -> Verifica se o agente está online`);
  console.log(`   - GET /printers -> Lista impressoras conectadas`);
  console.log(
    `   - POST /print/raw-buffer -> Imprime em uma impressora específica`
  );
  console.log(`=================================================`);
});
