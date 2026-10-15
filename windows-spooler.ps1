# Executado somente pelo Agent. Dados do usuario entram por JSON em stdin,
# nunca interpolados em comandos PowerShell/C#.
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)

try {
    $request = [Console]::In.ReadToEnd() | ConvertFrom-Json
    if ($request.action -eq 'list') {
        $printers = @(Get-CimInstance -ClassName Win32_Printer | ForEach-Object {
            [PSCustomObject]@{
                name = $_.Name
                driverName = $_.DriverName
                portName = $_.PortName
                offline = [bool]$_.WorkOffline
            }
        })
        @{ printers = $printers } | ConvertTo-Json -Depth 4 -Compress
        exit 0
    }
    if ($request.action -ne 'print') { throw 'Operacao Windows invalida.' }
    $printerName = [string]$request.printerName
    if ([string]::IsNullOrWhiteSpace($printerName) -or $printerName.Length -gt 256 -or $printerName.Contains([char]0)) {
        throw 'Nome da impressora Windows invalido.'
    }
    # Evita prompts de impressoras virtuais e nomes arbitrarios nao instalados.
    $printer = Get-CimInstance -ClassName Win32_Printer | Where-Object { $_.Name -eq $printerName } | Select-Object -First 1
    if ($null -eq $printer) { throw 'Impressora nao encontrada nas impressoras instaladas do Windows.' }
    if ($printer.PortName -match '^(PORTPROMPT:|FILE:|NUL:)$') {
        throw 'Selecione uma impressora termica fisica; portas virtuais/arquivo nao sao suportadas.'
    }
    $bytes = [Convert]::FromBase64String([string]$request.bufferB64)
    if ($bytes.Length -eq 0) { throw 'Buffer de impressao vazio.' }

    Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;

public static class DominaRawSpooler {
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    public class DocInfo {
        public string pDocName = "Domina - impressao termica";
        public string pOutputFile = null;
        public string pDatatype = "RAW";
    }
    [DllImport("winspool.drv", EntryPoint = "OpenPrinterW", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool OpenPrinter(string name, out IntPtr handle, IntPtr defaults);
    [DllImport("winspool.drv", SetLastError = true)]
    private static extern bool ClosePrinter(IntPtr handle);
    [DllImport("winspool.drv", EntryPoint = "StartDocPrinterW", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern uint StartDocPrinter(IntPtr handle, uint level, [In] DocInfo doc);
    [DllImport("winspool.drv", SetLastError = true)]
    private static extern bool EndDocPrinter(IntPtr handle);
    [DllImport("winspool.drv", SetLastError = true)]
    private static extern bool StartPagePrinter(IntPtr handle);
    [DllImport("winspool.drv", SetLastError = true)]
    private static extern bool EndPagePrinter(IntPtr handle);
    [DllImport("winspool.drv", SetLastError = true)]
    private static extern bool WritePrinter(IntPtr handle, IntPtr bytes, uint count, out uint written);
    [DllImport("winspool.drv", SetLastError = true)]
    private static extern bool AbortPrinter(IntPtr handle);

    private static void Check(bool success, string stage) {
        if (!success) throw new Win32Exception(Marshal.GetLastWin32Error(), "Falha Windows ao " + stage);
    }

    public static uint Print(string name, byte[] bytes) {
        IntPtr handle;
        Check(OpenPrinter(name, out handle, IntPtr.Zero), "abrir impressora");
        bool started = false, completed = false;
        GCHandle pinned = default(GCHandle);
        try {
            uint job = StartDocPrinter(handle, 1, new DocInfo());
            Check(job != 0, "iniciar documento RAW");
            started = true;
            Check(StartPagePrinter(handle), "iniciar pagina");
            pinned = GCHandle.Alloc(bytes, GCHandleType.Pinned);
            int offset = 0;
            while (offset < bytes.Length) {
                uint written;
                uint requested = (uint)Math.Min(65536, bytes.Length - offset);
                Check(WritePrinter(handle, IntPtr.Add(pinned.AddrOfPinnedObject(), offset), requested, out written), "enviar dados");
                if (written == 0 || written > requested) throw new InvalidOperationException("Escrita RAW incompleta.");
                offset += (int)written;
            }
            Check(EndPagePrinter(handle), "concluir pagina");
            Check(EndDocPrinter(handle), "concluir documento");
            completed = true;
            return job;
        } finally {
            if (pinned.IsAllocated) pinned.Free();
            if (started && !completed) AbortPrinter(handle);
            ClosePrinter(handle);
        }
    }
}
'@
    $jobId = [DominaRawSpooler]::Print($printerName, $bytes)
    @{ success = $true; jobId = $jobId } | ConvertTo-Json -Compress
    exit 0
} catch {
    @{ error = $_.Exception.Message } | ConvertTo-Json -Compress
    exit 1
}
