const { test } = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { PassThrough } = require("node:stream");
const { createWindowsPrinterService, validateWindowsPrinter } = require("../windows-printer");

function fixture(result, exitCode = 0) {
  const calls = [];
  const spawnProcess = (executable, args, options) => {
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.stdin = new PassThrough();
    child.kill = () => {};
    let input = "";
    child.stdin.on("data", (chunk) => { input += chunk.toString("utf8"); });
    child.stdin.on("finish", () => {
      calls.push({ executable, args, options, request: JSON.parse(input) });
      setImmediate(() => {
        child.stdout.end(typeof result === "string" ? result : JSON.stringify(result));
        child.emit("close", exitCode);
      });
    });
    return child;
  };
  return { calls, service: createWindowsPrinterService({ platform: "win32", spawnProcess }) };
}

test("nao Windows lista vazio e rejeita impressao sem executar processo", async () => {
  const service = createWindowsPrinterService({ platform: "linux", spawnProcess: () => assert.fail("nao executar") });
  assert.deepEqual(await service.list(), []);
  await assert.rejects(service.print(Buffer.from("abc"), { printerName: "L42" }), /somente no Windows/);
});

test("lista por nome, identificador estavel e filtra portas de arquivo", async () => {
  const f = fixture({ printers: [
    { name: "Elgin Etiquetas São João", driverName: "Elgin", portName: "USB001", offline: false },
    { name: "Print to PDF", portName: "PORTPROMPT:" },
  ] });
  const [printer] = await f.service.list();
  assert.equal(printer.type, "windows");
  assert.equal(printer.printerName, "Elgin Etiquetas São João");
  assert.equal(printer.portName, "USB001");
  assert.ok(printer.id.startsWith("windows-"));
  assert.equal((await f.service.list()).length, 1);
  assert.deepEqual(f.calls[0].request, { action: "list" });
  assert.equal(f.calls[0].options.windowsHide, true);
  assert.equal(f.calls[0].options.shell, false);
});

test("buffer binario e nome com aspas vao por stdin, nao pelo comando", async () => {
  const f = fixture({ success: true, jobId: 7 });
  const printerName = "Elgin '$(Remove-Item)' á";
  const bytes = Buffer.from([0, 27, 255, 10, 13, 94]);
  assert.deepEqual(await f.service.print(bytes, { printerName }), { jobId: 7 });
  const call = f.calls[0];
  assert.equal(call.request.printerName, printerName);
  assert.deepEqual(Buffer.from(call.request.bufferB64, "base64"), bytes);
  const command = Buffer.from(call.args.at(-1), "base64").toString("utf16le");
  assert.ok(command.includes('"RAW"'));
  assert.ok(command.includes("WritePrinter"));
  assert.ok(!command.includes(printerName));
  assert.ok(!command.includes(call.request.bufferB64));
});

test("rejeita nomes vazios/controle sem iniciar processo", async () => {
  const f = fixture({ success: true, jobId: 1 });
  for (const printerName of [null, "", " ", "L42\0", "L42\n", "a".repeat(257)]) {
    assert.ok(validateWindowsPrinter({ printerName }));
    await assert.rejects(f.service.print(Buffer.from("abc"), { printerName }), /printerName/);
  }
  assert.equal(f.calls.length, 0);
});

test("erro do spooler nao e sucesso nem causa reenvio", async () => {
  const f = fixture({ error: "Impressora inexistente" }, 1);
  await assert.rejects(f.service.print(Buffer.from("abc"), { printerName: "L42" }), /Impressora inexistente/);
  assert.equal(f.calls.length, 1);
});

test("sem confirmacao e jobId nao aceita sucesso", async () => {
  for (const result of [{ success: false }, { success: true }, { success: true, jobId: 0 }, { success: true, jobId: "7" }]) {
    const f = fixture(result);
    await assert.rejects(f.service.print(Buffer.from("abc"), { printerName: "L42" }), /nao confirmou/);
  }
});

test("resposta invalida nao e sucesso", async () => {
  for (const value of ["not json", "null", "7", "[]"]) {
    const f = fixture(value);
    await assert.rejects(f.service.list(), /Resposta invalida/);
  }
});
