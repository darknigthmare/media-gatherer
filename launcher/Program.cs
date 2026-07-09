using System;
using System.Diagnostics;
using System.IO;
using System.Net.Sockets;
using System.Threading;
using System.Windows.Forms;

static string FindProjectRoot()
{
    var dir = AppContext.BaseDirectory;
    for (var i = 0; i < 6; i++)
    {
        var serverPath = Path.Combine(dir, "server.js");
        if (File.Exists(serverPath)) return dir;
        var parent = Directory.GetParent(dir);
        if (parent == null) break;
        dir = parent.FullName;
    }

    var sibling = Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, ".."));
    if (File.Exists(Path.Combine(sibling, "server.js"))) return sibling;
    return Directory.GetCurrentDirectory();
}

static bool IsPortOpen(int port)
{
    try
    {
        using var client = new TcpClient();
        var task = client.ConnectAsync("127.0.0.1", port);
        return task.Wait(TimeSpan.FromMilliseconds(350)) && client.Connected;
    }
    catch
    {
        return false;
    }
}

static void OpenBrowser(string url)
{
    Process.Start(new ProcessStartInfo
    {
        FileName = url,
        UseShellExecute = true
    });
}

try
{
    var root = FindProjectRoot();
    var server = Path.Combine(root, "server.js");
    if (!File.Exists(server))
    {
        MessageBox.Show($"server.js introuvable. Placez MediaGatherer.exe dans le dossier du projet ou dans dist/.", "MediaGatherer", MessageBoxButtons.OK, MessageBoxIcon.Error);
        return;
    }

    if (!Directory.Exists(Path.Combine(root, "node_modules")))
    {
        MessageBox.Show("node_modules est introuvable. Lancez d'abord npm install dans le dossier MediaGatherer.", "MediaGatherer", MessageBoxButtons.OK, MessageBoxIcon.Warning);
        return;
    }

    const int port = 3000;
    if (!IsPortOpen(port))
    {
        Process.Start(new ProcessStartInfo
        {
            FileName = "node",
            Arguments = "server.js",
            WorkingDirectory = root,
            UseShellExecute = false,
            CreateNoWindow = true
        });
        Thread.Sleep(1800);
    }

    OpenBrowser($"http://localhost:{port}");
}
catch (Exception ex)
{
    MessageBox.Show(ex.Message, "MediaGatherer", MessageBoxButtons.OK, MessageBoxIcon.Error);
}
