const express = require("express");
const cors = require("cors");
const net = require("net");
const fs = require("fs");
const os = require("os");
const path = require("path");
const escpos = require("escpos");
escpos.USB = require("escpos-usb");

const app = express();
const PORT = Number(process.env.PRINT_AGENT_PORT) || 9100;

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

function printToUsbPrinter(printBuffer, printer) {
  return new Promise((resolve, reject) => {
    const vid = parseInt(printer.vid);
    const pid = parseInt(printer.pid);
    const device = new escpos.USB(vid, pid);

    device.open((error) => {
      if (error) {
        return reject(error);
      }

      device.write(printBuffer, (err) => {
        if (device.isOpen) {
          device.close();
        }

        if (err) {
          return reject(err);
        }

        resolve();
      });
    });
  });
}

function printToNetworkPrinter(printBuffer, printer) {
  return new Promise((resolve, reject) => {
    const socket = new net.Socket();
    let settled = false;

    function finish(error) {
      if (settled) {
        return;
      }

      settled = true;
      socket.destroy();

      if (error) {
        reject(error);
      } else {
        resolve();
      }
    }

    socket.setTimeout(10000);

    socket.connect(printer.port || 9100, printer.host, () => {
      socket.write(printBuffer, (error) => {
        if (error) {
          return finish(error);
        }

        socket.end(() => finish());
      });
    });

    socket.on("close", (hadError) => {
      if (!hadError) {
        finish();
      }
    });

    socket.on("error", finish);

    socket.on("timeout", () => {
      finish(new Error("Timeout ao conectar na impressora de rede."));
    });
  });
}

function validatePrinter(printer) {
  if (!printer) {
    return "É necessário enviar o objeto 'printer' para identificar a impressora.";
  }

  const type = printer.type || "usb";

  if (type === "usb") {
    if (!printer.vid || !printer.pid) {
      return "É necessário enviar 'vid' e 'pid' para impressoras USB.";
    }

    return null;
  }

  if (type === "network") {
    if (!printer.host || typeof printer.host !== "string") {
      return "É necessário enviar 'host' para impressoras de rede.";
    }

    if (
      printer.port &&
      (!Number.isInteger(Number(printer.port)) ||
        Number(printer.port) < 1 ||
        Number(printer.port) > 65535)
    ) {
      return "A porta da impressora de rede deve ser um número entre 1 e 65535.";
    }

    return null;
  }

  return "Tipo de impressora inválido. Use 'usb' ou 'network'.";
}

function getDataDir() {
  if (process.env.PRINT_AGENT_DATA_DIR) {
    return process.env.PRINT_AGENT_DATA_DIR;
  }

  if (process.platform === "win32" && process.env.ProgramData) {
    return path.join(process.env.ProgramData, "PrintAgent");
  }

  return path.join(__dirname, "data");
}

function getPrintersFilePath() {
  return path.join(getDataDir(), "printers.json");
}

function getEmptyPrinterStore() {
  return { networkPrinters: [] };
}

function ensureDataDir() {
  fs.mkdirSync(getDataDir(), { recursive: true });
}

function readPrinterStore() {
  try {
    const filePath = getPrintersFilePath();

    if (!fs.existsSync(filePath)) {
      return getEmptyPrinterStore();
    }

    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));

    return {
      networkPrinters: Array.isArray(parsed.networkPrinters)
        ? parsed.networkPrinters
        : [],
    };
  } catch (error) {
    console.warn(`Aviso: nao foi possivel ler o cadastro local. ${error.message}`);
    return getEmptyPrinterStore();
  }
}

function writePrinterStore(store) {
  ensureDataDir();
  fs.writeFileSync(getPrintersFilePath(), JSON.stringify(store, null, 2));
}

function normalizePort(port) {
  return port ? Number(port) : 9100;
}

function createNetworkPrinterId(host, port) {
  return `network-${host}-${port}`.replace(/[^a-zA-Z0-9_-]/g, "-");
}

function normalizeNetworkPrinter(printer) {
  const host = String(printer.host || "").trim();
  const port = normalizePort(printer.port);

  return {
    id: printer.id || createNetworkPrinterId(host, port),
    type: "network",
    name: printer.name || `Impressora de rede ${host}`,
    host,
    port,
  };
}

function getSavedNetworkPrinters() {
  return readPrinterStore().networkPrinters;
}

function findSavedPrinterById(printerId) {
  return getSavedNetworkPrinters().find((printer) => printer.id === printerId);
}

function getLocalIPv4Interfaces() {
  return Object.values(os.networkInterfaces())
    .flat()
    .filter(
      (iface) =>
        iface &&
        iface.family === "IPv4" &&
        !iface.internal &&
        iface.address &&
        iface.netmask
    );
}

function getCidrPrefixFromNetmask(netmask) {
  return netmask
    .split(".")
    .map((part) => Number(part).toString(2).padStart(8, "0"))
    .join("")
    .replace(/0+$/, "").length;
}

function getDefaultScanSubnet() {
  const iface = getLocalIPv4Interfaces()[0];

  if (!iface) {
    return null;
  }

  const parts = iface.address.split(".");
  return {
    base: `${parts[0]}.${parts[1]}.${parts[2]}`,
    cidr: getCidrPrefixFromNetmask(iface.netmask),
    interfaceAddress: iface.address,
  };
}

function buildScanTargets(subnet) {
  const selectedSubnet = subnet || getDefaultScanSubnet();

  if (!selectedSubnet) {
    return [];
  }

  if (typeof selectedSubnet === "string") {
    const address = selectedSubnet.replace(/\/24$/, "");
    const parts = address.split(".");
    const normalized = parts.length >= 3 ? parts.slice(0, 3).join(".") : address;
    return Array.from({ length: 254 }, (_, index) => `${normalized}.${index + 1}`);
  }

  return Array.from(
    { length: 254 },
    (_, index) => `${selectedSubnet.base}.${index + 1}`
  );
}

function checkTcpPort(host, port, timeoutMs) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let settled = false;

    function finish(isOpen) {
      if (settled) {
        return;
      }

      settled = true;
      socket.destroy();
      resolve(isOpen);
    }

    socket.setTimeout(timeoutMs);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
    socket.connect(port, host);
  });
}

async function runWithConcurrency(items, limit, worker) {
  const results = [];
  let index = 0;

  async function runNext() {
    while (index < items.length) {
      const currentIndex = index++;
      results[currentIndex] = await worker(items[currentIndex], currentIndex);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, () => runNext())
  );

  return results;
}

async function scanNetworkPrinters(options = {}) {
  const port = normalizePort(options.port);
  const timeoutMs = Number(options.timeoutMs) || 350;
  const concurrency = Number(options.concurrency) || 64;
  const targets = buildScanTargets(options.subnet);

  const scanResults = await runWithConcurrency(targets, concurrency, async (host) => {
    const isOpen = await checkTcpPort(host, port, timeoutMs);

    if (!isOpen) {
      return null;
    }

    return {
      id: createNetworkPrinterId(host, port),
      type: "network",
      name: `Impressora de rede ${host}`,
      host,
      port,
      discoveredBy: ["tcp-9100"],
    };
  });

  return scanResults.filter(Boolean);
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
        type: "usb",
        name,
        manufacturer,
        vid: `0x${device.deviceDescriptor.idVendor.toString(16)}`,
        pid: `0x${device.deviceDescriptor.idProduct.toString(16)}`,
        deviceAddress: device.deviceAddress,
      });
    }

    res.json([...printerList, ...getSavedNetworkPrinters()]);
  } catch (error) {
    console.error("Erro ao buscar impressoras:", error);
    res
      .status(500)
      .json({ error: "Falha ao listar impressoras.", details: error.message });
  }
});

app.get("/printers/network/scan", async (req, res) => {
  try {
    const printers = await scanNetworkPrinters({
      subnet: req.query.subnet,
      port: req.query.port,
      timeoutMs: req.query.timeoutMs,
      concurrency: req.query.concurrency,
    });

    res.json({
      printers,
      count: printers.length,
    });
  } catch (error) {
    console.error("Erro ao buscar impressoras de rede:", error);
    res.status(500).json({
      error: "Falha ao listar impressoras de rede.",
      details: error.message,
    });
  }
});

app.get("/printers/network", (req, res) => {
  res.json(getSavedNetworkPrinters());
});

app.post("/printers/network", (req, res) => {
  try {
    const printer = normalizeNetworkPrinter(req.body || {});
    const validationError = validatePrinter(printer);

    if (validationError) {
      return res.status(400).json({ error: validationError });
    }

    const store = readPrinterStore();
    const existingIndex = store.networkPrinters.findIndex(
      (savedPrinter) => savedPrinter.id === printer.id
    );

    if (existingIndex >= 0) {
      store.networkPrinters[existingIndex] = printer;
    } else {
      store.networkPrinters.push(printer);
    }

    writePrinterStore(store);

    res.status(existingIndex >= 0 ? 200 : 201).json(printer);
  } catch (error) {
    console.error("Erro ao salvar impressora de rede:", error);
    res.status(500).json({
      error: "Falha ao salvar impressora de rede.",
      details: error.message,
    });
  }
});

app.delete("/printers/network/:id", (req, res) => {
  try {
    const store = readPrinterStore();
    const initialLength = store.networkPrinters.length;
    store.networkPrinters = store.networkPrinters.filter(
      (printer) => printer.id !== req.params.id
    );

    if (store.networkPrinters.length === initialLength) {
      return res.status(404).json({ error: "Impressora de rede nao encontrada." });
    }

    writePrinterStore(store);
    res.json({ success: true });
  } catch (error) {
    console.error("Erro ao remover impressora de rede:", error);
    res.status(500).json({
      error: "Falha ao remover impressora de rede.",
      details: error.message,
    });
  }
});

// Rota principal que recebe os comandos e o ID da impressora
app.post("/print/raw-buffer", async (req, res) => {
  try {
    const { bufferB64, printerId } = req.body;
    let { printer } = req.body;
    if (!bufferB64) {
      return res.status(400).json({
        error: "É necessário enviar o 'bufferB64' no corpo da requisição.",
      });
    }

    if (printerId) {
      printer = findSavedPrinterById(printerId);

      if (!printer) {
        return res.status(404).json({ error: "Impressora cadastrada nao encontrada." });
      }
    }

    const validationError = validatePrinter(printer);
    if (validationError) {
      return res.status(400).json({ error: validationError });
    }

    const printBuffer = Buffer.from(bufferB64, "base64");
    const printerType = printer.type || "usb";

    if (printerType === "network") {
      await printToNetworkPrinter(printBuffer, {
        ...printer,
        port: printer.port ? Number(printer.port) : 9100,
      });
    } else {
      await printToUsbPrinter(printBuffer, printer);
    }

    res.json({
      success: true,
      message: "Dados brutos enviados para a impressora.",
    });
  } catch (err) {
    console.error("Erro geral na rota /print/raw-buffer:", err);
    res.status(500).json({
      error: "Ocorreu um erro inesperado no agente.",
      details: err.message,
    });
  }
});

// Mantido apenas como referência de compatibilidade USB do agente 2.0.
app.post("/print/raw-buffer-usb-legacy", async (req, res) => {
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
