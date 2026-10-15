// Uma fila compartilhada evita listar/fechar o mesmo dispositivo durante uma escrita.
// Cada operacao consulta novamente o USB; nao guarda handles entre trabalhos.
function createUsbPrinterService({ findPrinters, logger = console, platform = process.platform }) {
  let pending = Promise.resolve();

  function enqueue(operation) {
    const result = pending.then(operation);
    pending = result.catch(() => {});
    return result;
  }

  function callbackOperation(operation) {
    return new Promise((resolve, reject) => {
      operation((error, value) => error ? reject(error) : resolve(value));
    });
  }

  async function usbOperation(stage, operation) {
    try {
      return await operation();
    } catch (cause) {
      const error = new Error(`Falha USB ao ${stage}: ${cause.message}`, { cause });
      error.errno = cause.errno;
      error.code = cause.code;
      error.usbStage = stage;
      throw error;
    }
  }

  async function withDevice(device, operation) {
    let opened = false;
    let claimedInterface;
    let detachedInterface;
    try {
      await usbOperation("abrir dispositivo", () => device.open());
      opened = true;
      device.timeout = 2000;
      return await operation({
        async claim(iface) {
          if (platform !== "win32" && iface.isKernelDriverActive()) {
            iface.detachKernelDriver();
            detachedInterface = iface;
          }
          await usbOperation("reservar interface", () => iface.claim());
          claimedInterface = iface;
          // libusb exige claim ANTES de setAltSetting. A configuracao padrao (0)
          // ja esta ativa; seleciona-la novamente e desnecessario e pode falhar
          // em drivers/dispositivos que nao implementam configuracoes alternativas.
          if (iface.altSetting !== 0) {
            await usbOperation("selecionar configuracao da interface", () =>
              callbackOperation((done) => iface.setAltSetting(iface.altSetting, done)));
          }
        },
      });
    } finally {
      if (claimedInterface) {
        try {
          await callbackOperation((done) => claimedInterface.release(true, done));
        } catch (error) {
          logger.warn(`USB: falha ao liberar interface: ${error.message}`);
        }
      }
      if (detachedInterface) {
        try {
          detachedInterface.attachKernelDriver();
        } catch (error) {
          logger.warn(`USB: falha ao restaurar driver: ${error.message}`);
        }
      }
      if (opened) {
        try {
          device.close();
        } catch (error) {
          // Nao transformar uma escrita concluida em erro/reenvio por falha de limpeza.
          logger.warn(`USB: falha ao fechar dispositivo: ${error.message}`);
        }
      }
    }
  }

  function readDescriptor(device, index) {
    return callbackOperation((done) => device.getStringDescriptor(index, done))
      .then((value) => value.replace(/\0/g, "").trim());
  }

  function list() {
    return enqueue(async () => {
      const printers = [];
      for (const device of findPrinters()) {
        let name = "Dispositivo USB Genérico";
        let manufacturer = "Fabricante Desconhecido";
        try {
          await withDevice(device, async () => {
            if (device.deviceDescriptor.iProduct > 0) {
              name = await readDescriptor(device, device.deviceDescriptor.iProduct);
            }
            if (device.deviceDescriptor.iManufacturer > 0) {
              manufacturer = await readDescriptor(device, device.deviceDescriptor.iManufacturer);
            }
          });
        } catch (error) {
          logger.warn(`USB: nao foi possivel ler os detalhes: ${error.message}`);
        }
        printers.push({
          type: "usb", name, manufacturer,
          vid: `0x${device.deviceDescriptor.idVendor.toString(16)}`,
          pid: `0x${device.deviceDescriptor.idProduct.toString(16)}`,
          deviceAddress: device.deviceAddress,
        });
      }
      return printers;
    });
  }

  function print(buffer, printer) {
    return enqueue(async () => {
      const vid = Number(printer.vid);
      const pid = Number(printer.pid);
      if (!Number.isInteger(vid) || !Number.isInteger(pid) || vid < 1 || pid < 1 || vid > 65535 || pid > 65535) {
        throw new Error("VID/PID da impressora USB invalidos.");
      }
      const device = findPrinters().find((candidate) =>
        candidate.deviceDescriptor.idVendor === vid && candidate.deviceDescriptor.idProduct === pid);
      if (!device) {
        throw new Error("Impressora USB nao encontrada. Confira se esta ligada e conectada.");
      }
      await withDevice(device, async ({ claim }) => {
        const iface = device.interfaces.find((candidate) =>
          candidate.descriptor.bInterfaceClass === 0x07 &&
          candidate.endpoints.some((endpoint) => endpoint.direction === "out"));
        if (!iface) throw new Error("Interface de impressao USB nao encontrada.");
        await claim(iface);
        const endpoint = iface.endpoints.find((candidate) => candidate.direction === "out");
        endpoint.timeout = 10000;
        // Nunca repetir automaticamente: uma falha pode ocorrer apos impressao parcial.
        await usbOperation("enviar dados", () =>
          callbackOperation((done) => endpoint.transfer(buffer, done)));
      });
    });
  }

  return { list, print };
}

module.exports = { createUsbPrinterService };
