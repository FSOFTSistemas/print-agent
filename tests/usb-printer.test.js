const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createUsbPrinterService } = require("../usb-printer");

const printer = { vid: "0x1234", pid: "0x5678", deviceAddress: 1 };
const buffer = Buffer.from("^XA^FO10,10^FDTeste^FS^XZ");

function fixture(options = {}) {
  const events = [];
  let finishTransfer;
  const endpoint = {
    direction: "out",
    transfer(data, done) {
      events.push("write");
      assert.equal(data, buffer);
      assert.equal(this.timeout, 10000);
      if (options.holdTransfer) finishTransfer = done;
      else if (options.throwTransfer) throw new Error("write sync");
      else done(options.writeError);
    },
  };
  const iface = {
    altSetting: 0,
    descriptor: { bInterfaceClass: 7 },
    endpoints: [endpoint],
    setAltSetting(value, done) { events.push("alt"); done(options.altError); },
    isKernelDriverActive() { return true; },
    detachKernelDriver() { events.push("detach"); },
    attachKernelDriver() { events.push("attach"); },
    claim() {
      events.push("claim");
      if (options.claimError) throw options.claimError;
    },
    release(closeEndpoints, done) {
      assert.equal(closeEndpoints, true);
      events.push("release");
      done(options.releaseError);
    },
  };
  const device = {
    deviceAddress: options.address || 1,
    deviceDescriptor: { idVendor: 0x1234, idProduct: 0x5678, iProduct: 1, iManufacturer: 2 },
    open() {
      events.push("open");
      if (options.openError) throw options.openError;
      this.interfaces = [iface];
    },
    getStringDescriptor(index, done) {
      events.push(`descriptor:${index}`);
      done(options.descriptorError, index === 1 ? " L42\0 " : " Elgin\0 ");
    },
    close() {
      events.push("close");
      this.interfaces = null;
      if (options.closeError) throw options.closeError;
    },
  };
  const service = createUsbPrinterService({
    findPrinters: () => [device],
    platform: "win32",
    logger: { warn: (message) => events.push(`warn:${message}`) },
  });
  return { device, iface, events, service, complete: (error) => finishTransfer(error) };
}

test("lista identificacao e fecha dispositivo sem depender de isOpen", async () => {
  const f = fixture();
  assert.equal(f.device.isOpen, undefined);
  assert.deepEqual(await f.service.list(), [{
    type: "usb", name: "L42", manufacturer: "Elgin",
    vid: printer.vid, pid: printer.pid, deviceAddress: 1,
  }]);
  assert.deepEqual(f.events, ["open", "descriptor:1", "descriptor:2", "close"]);
});

test("erro de descritor tambem fecha e permite a proxima operacao", async () => {
  const f = fixture({ descriptorError: new Error("LIBUSB_ERROR_NO_DEVICE") });
  const [listed] = await f.service.list();
  assert.equal(listed.name, "Dispositivo USB Genérico");
  assert.ok(f.events.includes("close"));
  await f.service.print(buffer, printer);
  assert.equal(f.events.filter((event) => event === "close").length, 2);
});

test("imprime bytes intactos e libera interface antes de fechar", async () => {
  const f = fixture();
  await f.service.print(buffer, printer);
  assert.deepEqual(f.events, ["open", "claim", "write", "release", "close"]);
});

test("regressao: libusb rejeita setAltSetting antes de claim com NOT_FOUND (-5)", async () => {
  const f = fixture();
  f.iface.setAltSetting = (value, done) => {
    if (!f.events.includes("claim")) {
      return done(Object.assign(new Error("LIBUSB_ERROR_NOT_FOUND"), { errno: -5 }));
    }
    done();
  };
  await f.service.print(buffer, printer);
  assert.ok(f.events.includes("write"));
});

test("configuracao padrao nao chama setAltSetting", async () => {
  const f = fixture();
  f.iface.setAltSetting = () => assert.fail("Alt 0 ja esta ativo");
  await f.service.print(buffer, printer);
  assert.deepEqual(f.events, ["open", "claim", "write", "release", "close"]);
});

test("configuracao alternativa so e selecionada depois de claim", async () => {
  const f = fixture();
  f.iface.altSetting = 1;
  f.iface.setAltSetting = (value, done) => {
    assert.equal(value, 1);
    assert.deepEqual(f.events, ["open", "claim"]);
    f.events.push("alt");
    done();
  };
  await f.service.print(buffer, printer);
  assert.deepEqual(f.events, ["open", "claim", "alt", "write", "release", "close"]);
});

test("erro informa etapa e preserva codigo nativo da libusb", async () => {
  const cause = Object.assign(new Error("LIBUSB_ERROR_NOT_FOUND"), { errno: -5 });
  const f = fixture({ claimError: cause });
  await assert.rejects(f.service.print(buffer, printer), (error) => {
    assert.match(error.message, /reservar interface: LIBUSB_ERROR_NOT_FOUND/);
    assert.equal(error.errno, -5);
    assert.equal(error.cause, cause);
    return true;
  });
});

test("erro na escrita nao reenvia e libera o dispositivo", async () => {
  const f = fixture({ writeError: new Error("LIBUSB_ERROR_NO_DEVICE") });
  await assert.rejects(f.service.print(buffer, printer), /LIBUSB_ERROR_NO_DEVICE/);
  assert.equal(f.events.filter((event) => event === "write").length, 1);
  assert.deepEqual(f.events.slice(-2), ["release", "close"]);
});

test("excecao sincrona na escrita tambem libera a interface", async () => {
  const f = fixture({ throwTransfer: true });
  await assert.rejects(f.service.print(buffer, printer), /write sync/);
  assert.deepEqual(f.events.slice(-2), ["release", "close"]);
});

test("falha ao obter interface fecha o handle sem tentar liberar interface nao obtida", async () => {
  const f = fixture({ claimError: new Error("LIBUSB_ERROR_BUSY") });
  await assert.rejects(f.service.print(buffer, printer), /LIBUSB_ERROR_BUSY/);
  assert.deepEqual(f.events, ["open", "claim", "close"]);
});

test("erro ao configurar interface nao tenta escrever", async () => {
  const f = fixture({ altError: new Error("disconnected") });
  f.iface.altSetting = 1;
  await assert.rejects(f.service.print(buffer, printer), /disconnected/);
  assert.deepEqual(f.events, ["open", "claim", "alt", "release", "close"]);
});

test("erro de abertura nao tenta fechar dispositivo nao aberto", async () => {
  const f = fixture({ openError: new Error("LIBUSB_ERROR_ACCESS") });
  await assert.rejects(f.service.print(buffer, printer), /LIBUSB_ERROR_ACCESS/);
  assert.deepEqual(f.events, ["open"]);
});

test("falhas de limpeza sao registradas sem solicitar reenvio de trabalho ja escrito", async () => {
  const f = fixture({ releaseError: new Error("gone"), closeError: new Error("close failed") });
  await f.service.print(buffer, printer);
  assert.ok(f.events.includes("close"));
  assert.equal(f.events.filter((event) => event.startsWith("warn:")).length, 2);
  assert.equal(f.events.filter((event) => event === "write").length, 1);
});

test("desconectar e reconectar com outro endereco nao exige reiniciar o servico", async () => {
  const first = fixture();
  const second = fixture({ address: 9 });
  let devices = [first.device];
  const service = createUsbPrinterService({ findPrinters: () => devices, platform: "win32" });
  await service.print(buffer, printer);
  devices = [];
  await assert.rejects(service.print(buffer, printer), /nao encontrada/);
  devices = [second.device];
  await service.print(buffer, printer); // Configuracao antiga continua valida por VID/PID.
  assert.equal((await service.list())[0].deviceAddress, 9);
  assert.ok(second.events.includes("write"));
});

test("listagem e segunda impressao aguardam a primeira liberar o USB", async () => {
  const f = fixture({ holdTransfer: true });
  const first = f.service.print(buffer, printer);
  const listing = f.service.list();
  const second = f.service.print(buffer, printer);
  await new Promise(setImmediate);
  assert.deepEqual(f.events, ["open", "claim", "write"]);
  f.complete();
  await first;
  await listing;
  await new Promise(setImmediate);
  assert.deepEqual(f.events.slice(3), [
    "release", "close", "open", "descriptor:1", "descriptor:2", "close",
    "open", "claim", "write",
  ]);
  f.complete();
  await second;
});

test("fila continua apos erro de escrita", async () => {
  const failed = fixture({ writeError: new Error("gone") });
  const next = fixture();
  let count = 0;
  const service = createUsbPrinterService({
    findPrinters: () => [count++ === 0 ? failed.device : next.device], platform: "win32",
  });
  const first = service.print(buffer, printer);
  const second = service.print(buffer, printer);
  await assert.rejects(first, /gone/);
  await second;
  assert.ok(next.events.includes("write"));
});

test("ausencia de endpoint fecha dispositivo", async () => {
  const f = fixture();
  f.iface.endpoints = [];
  await assert.rejects(f.service.print(buffer, printer), /Interface/);
  assert.deepEqual(f.events, ["open", "close"]);
});

test("Linux restaura driver destacado e preserva fluxo de limpeza", async () => {
  const f = fixture();
  const service = createUsbPrinterService({ findPrinters: () => [f.device], platform: "linux" });
  await service.print(buffer, printer);
  assert.deepEqual(f.events, ["open", "detach", "claim", "write", "release", "attach", "close"]);
});

test("valida VID/PID sem abrir USB", async () => {
  const f = fixture();
  await assert.rejects(f.service.print(buffer, { vid: "invalido", pid: printer.pid }), /invalidos/);
  assert.deepEqual(f.events, []);
});

// Executa as rotas reais sem abrir uma porta HTTP nem carregar o USB nativo.
function loadRoutes(device) {
  const fs = require("node:fs");
  const vm = require("node:vm");
  const path = require("node:path");
  const routes = new Map();
  const app = {
    use() {}, listen() {},
    get(route, handler) { routes.set(`GET ${route}`, handler); },
    post(route, handler) { routes.set(`POST ${route}`, handler); },
    delete() {},
  };
  const express = () => app;
  express.json = () => () => {};
  const dirname = path.resolve(__dirname, "..");
  const fakeEscpos = {};
  function USB() { throw new Error("Nao deve criar adaptador com listener de detach por trabalho"); }
  USB.findPrinter = () => [device];
  vm.runInNewContext(fs.readFileSync(path.join(dirname, "server.js"), "utf8"), {
    Buffer, process, __dirname: dirname,
    console: { log() {}, warn() {}, error() {} },
    require(name) {
      if (name === "express") return express;
      if (name === "cors") return () => () => {};
      if (name === "escpos") return fakeEscpos;
      if (name === "escpos-usb") return USB;
      if (name === "./usb-printer") return { createUsbPrinterService };
      if (name === "fs") return { existsSync: () => false };
      return require(name);
    },
  });
  return async function request(method, route, body) {
    const response = { code: 200, status(code) { this.code = code; return this; }, json(value) { this.body = value; } };
    await routes.get(`${method} ${route}`)({ body }, response);
    return response;
  };
}

test("rota GET /printers preserva contrato e fecha USB", async () => {
  const f = fixture();
  const request = loadRoutes(f.device);
  const result = await request("GET", "/printers");
  assert.equal(result.code, 200);
  assert.equal(result.body[0].name, "L42");
  assert.equal(result.body[0].vid, printer.vid);
  assert.equal(f.events.at(-1), "close");
});

for (const route of ["/print/raw-buffer", "/print/raw-buffer-usb-legacy"]) {
  test(`rota ${route} usa limpeza centralizada e retorna sucesso`, async () => {
    const f = fixture();
    const received = [];
    f.iface.endpoints[0].transfer = (data, done) => { received.push(data); done(); };
    const request = loadRoutes(f.device);
    const result = await request("POST", route, { printer, bufferB64: buffer.toString("base64") });
    assert.equal(result.code, 200);
    assert.equal(result.body.success, true);
    assert.deepEqual(received, [buffer]);
    assert.deepEqual(f.events.slice(-2), ["release", "close"]);
  });
}

test("erro USB retorna HTTP 500 sem derrubar a rota seguinte", async () => {
  const f = fixture({ claimError: new Error("LIBUSB_ERROR_NO_DEVICE") });
  const request = loadRoutes(f.device);
  const result = await request("POST", "/print/raw-buffer", { printer, bufferB64: buffer.toString("base64") });
  assert.equal(result.code, 500);
  assert.match(result.body.details, /reservar interface: LIBUSB_ERROR_NO_DEVICE/);
  assert.equal((await request("GET", "/printers")).body[0].name, "L42");
});
