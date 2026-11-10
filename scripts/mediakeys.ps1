# Escuta SOMENTE as teclas multimídia do teclado (play/pause, próxima, anterior, parar)
# e avisa o servidor do Sonora pela saída padrão. Não lê nenhuma outra tecla.
# Enquanto roda, essas teclas ficam reservadas para o Sonora (o Windows as entrega só a ele).
# Encerra sozinho quando o servidor do Sonora fecha (fim da entrada padrão).

$src = @"
using System;
using System.Runtime.InteropServices;
using System.Threading;
using System.Windows.Forms;

public class SonoraMediaKeys : Form {
    [DllImport("user32.dll")] static extern bool RegisterHotKey(IntPtr hWnd, int id, uint fsModifiers, uint vk);
    [DllImport("user32.dll")] static extern bool UnregisterHotKey(IntPtr hWnd, int id);

    const int WM_HOTKEY = 0x0312;
    const uint MOD_NOREPEAT = 0x4000;
    static readonly uint[] Keys = { 0xB3, 0xB0, 0xB1, 0xB2 }; // VK_MEDIA_PLAY_PAUSE, NEXT, PREV, STOP
    static readonly string[] Names = { "playpause", "next", "prev", "stop" };

    public SonoraMediaKeys() {
        CreateHandle();
        for (int i = 0; i < Keys.Length; i++) {
            bool ok = RegisterHotKey(Handle, i + 1, MOD_NOREPEAT, Keys[i]);
            Console.WriteLine((ok ? "ok " : "fail ") + Names[i]);
        }
        Console.Out.Flush();
    }

    protected override void WndProc(ref Message m) {
        if (m.Msg == WM_HOTKEY) {
            int id = m.WParam.ToInt32();
            if (id >= 1 && id <= Names.Length) { Console.WriteLine("key " + Names[id - 1]); Console.Out.Flush(); }
        }
        base.WndProc(ref m);
    }

    protected override void Dispose(bool disposing) {
        for (int i = 0; i < Keys.Length; i++) UnregisterHotKey(Handle, i + 1);
        base.Dispose(disposing);
    }

    public static void Run() {
        var form = new SonoraMediaKeys();
        // quando o servidor fecha, a entrada padrão termina: libera as teclas e sai
        var watcher = new Thread(() => { try { while (Console.In.Read() != -1) { } } catch { } form.BeginInvoke((Action)(() => Application.ExitThread())); });
        watcher.IsBackground = true;
        watcher.Start();
        Application.Run();
        form.Dispose();
    }
}
"@

Add-Type -TypeDefinition $src -ReferencedAssemblies System.Windows.Forms
[SonoraMediaKeys]::Run()
