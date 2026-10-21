// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import com.checkba.service.LibreOfficePdfConverter;
import com.checkba.service.ai.tools.PythonTools;
import com.checkba.service.tmeet.TmeetCliService;
import com.checkba.service.pack.*;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.apache.poi.xwpf.usermodel.*;
import org.apache.pdfbox.Loader;
import org.apache.pdfbox.text.PDFTextStripper;
import org.apache.pdfbox.rendering.PDFRenderer;
import javax.imageio.ImageIO;
import java.nio.file.*;
import java.util.*;
import java.util.concurrent.TimeUnit;

/** Calls installed production classes; no mocks, replacements or developer runtime on PATH. */
public class DependencyProbe {
    static final ObjectMapper JSON = new ObjectMapper();
    static void check(boolean value, String message) { if (!value) throw new AssertionError(message); }
    static void write(Path root, String name, Object data) throws Exception {
        JSON.writerWithDefaultPrettyPrinter().writeValue(root.resolve(name).toFile(), data);
    }
    static void run(Path root, String log, List<String> command, int seconds) throws Exception {
        Process process = new ProcessBuilder(command).redirectErrorStream(true).redirectOutput(root.resolve(log).toFile()).start();
        if (!process.waitFor(seconds, TimeUnit.SECONDS)) {
            process.descendants().forEach(ProcessHandle::destroyForcibly); process.destroyForcibly();
            throw new AssertionError(log + " timed out");
        }
        check(process.exitValue() == 0, log + " exited " + process.exitValue());
    }
    public static void main(String[] args) throws Exception {
        Path root = Path.of(args[0]), resources = Path.of(args[1]);
        Path temporary = Files.createTempFile("awd-standard-user-", ".txt");
        Files.writeString(temporary, "synthetic temporary-directory write check");
        write(root, "temporary-directory.json", Map.of("path", System.getProperty("java.io.tmpdir"), "writable", true));
        Files.delete(temporary);
        var lo = new LibreOfficePdfConverter();
        var docker = new PythonTools(null, null, null, null);
        var tmeet = new TmeetCliService(root.resolve("npm/tmeet.cmd").toString());
        check(!Files.exists(Path.of(System.getenv("ProgramFiles"), "nodejs/node.exe")), "Runner Node leaked into missing stage");
        var before = Map.of("libreoffice", lo.probe(), "docker", docker.refreshDockerStatus(),
                "tmeet", tmeet.isCliAvailable(), "javaHome", System.getProperty("java.home"),
                "home", System.getProperty("user.home"), "path", System.getenv("PATH"));
        write(root, "missing-observed.json", before);
        check(lo.probe().status().equals("MISSING"), "LibreOffice is not genuinely absent from product discovery");
        check(docker.refreshDockerStatus().equals("MISSING"), "Docker is not absent from product discovery");
        check(!tmeet.isCliAvailable(), "tmeet unexpectedly available");
        try { lo.convert(new byte[0], "docx"); throw new AssertionError("Missing LO must fail"); }
        catch (LibreOfficePdfConverter.ConversionException error) {
            check(error.failure == LibreOfficePdfConverter.Failure.NOT_INSTALLED, "Incorrect missing LO category");
            Files.writeString(root.resolve("missing-lo.txt"), error.getMessage());
        }
        run(root, "bundled-python.log", List.of(resources.resolve("python/python.exe").toString(), "-I", "-c",
                "import sys,ssl,sqlite3,json; print(json.dumps({'executable':sys.executable,'version':sys.version,'sqlite':sqlite3.sqlite_version}))"), 30);
        // Same production instances remain alive while the runner administrator installs real MSIs.
        write(root, "before.json", before);
        long deadline = System.nanoTime() + TimeUnit.MINUTES.toNanos(25);
        while (!Files.exists(root.resolve("installed.ready"))) {
            check(System.nanoTime() < deadline, "Dependency installation exceeded 25 minutes"); Thread.sleep(500);
        }
        var loAfter = lo.probe();
        var installation = new LinkedHashMap<String, Object>();
        installation.put("libreoffice", loAfter);
        installation.put("environment", System.getenv().entrySet().stream()
                .filter(e -> e.getKey().toLowerCase(Locale.ROOT).contains("programfiles") || e.getKey().equalsIgnoreCase("ProgramW6432"))
                .collect(java.util.stream.Collectors.toMap(Map.Entry::getKey, Map.Entry::getValue)));
        Path soffice = Path.of("C:\\Program Files\\LibreOffice\\program\\soffice.exe");
        installation.put("knownFile", Map.of("exists", Files.isRegularFile(soffice), "executable", Files.isExecutable(soffice)));
        write(root, "installed-observed.json", installation);
        if (!loAfter.status().equals("AVAILABLE")) {
            for (String name : List.of("soffice.exe", "soffice.com")) {
                try { run(root, name + "-version.log", List.of(soffice.resolveSibling(name).toString(), "--headless", "--version"), 20); }
                catch (AssertionError | java.io.IOException diagnostic) { Files.writeString(root.resolve(name + "-failure.txt"), diagnostic.toString()); }
            }
            throw new AssertionError("LO install did not restore production probe: " + loAfter);
        }
        check(tmeet.isCliAvailable(), "Node + npm tmeet install did not restore production probe");
        var auth = tmeet.getAuthStatus();
        check(!auth.isLoggedIn(), "Clean user unexpectedly has tmeet credentials");
        write(root, "after.json", Map.of("libreoffice", lo.probe(), "docker", docker.refreshDockerStatus(),
                "tmeetAvailable", auth.isCliAvailable(), "tmeetLoggedIn", auth.isLoggedIn(), "tmeetMessage", String.valueOf(auth.getMessage())));
        byte[] docx;
        try (var doc = new XWPFDocument(); var out = new java.io.ByteArrayOutputStream()) {
            for (int page = 1; page <= 2; page++) {
                if (page > 1) doc.createParagraph().setPageBreak(true);
                var run = doc.createParagraph().createRun(); run.setFontFamily("Microsoft YaHei");
                run.setText("合成验收第" + page + "页：合同金额 CNY " + page + "00。中文应完整保留。");
                var table = doc.createTable(2, 2); table.getRow(0).getCell(0).setText("条款");
                table.getRow(0).getCell(1).setText("金额"); table.getRow(1).getCell(0).setText("测试内容");
                table.getRow(1).getCell(1).setText("人民币壹佰元");
            }
            doc.write(out); docx = out.toByteArray();
        }
        Files.write(root.resolve("synthetic.docx"), docx);
        byte[] pdf = lo.convert(docx, "docx"); Files.write(root.resolve("synthetic.pdf"), pdf);
        try (var doc = Loader.loadPDF(pdf)) {
            check(doc.getNumberOfPages() == 2, "Expected exactly two pages, got " + doc.getNumberOfPages());
            String text = new PDFTextStripper().getText(doc); Files.writeString(root.resolve("pdf-text.txt"), text);
            var renderer = new PDFRenderer(doc);
            for (int page = 0; page < 2; page++) ImageIO.write(renderer.renderImageWithDPI(page, 100), "png", root.resolve("page-" + (page + 1) + ".png").toFile());
            // PDF text extraction can insert layout spaces between CJK and digits.
            String compact = text.replaceAll("\\s+", "");
            for (String expected : List.of("合成验收第1页", "合成验收第2页", "合同金额", "人民币壹佰元", "CNY100", "CNY200"))
                check(compact.contains(expected), "PDF lost " + expected);
        }
        // The verifier does not install models or use account/OAuth credentials.
        var props = new PackProperties(); props.setDir(root.resolve("packs").toString()); props.setAutoUpgrade(false);
        var packs = new NativePackService(props, Files.readString(root.resolve("public.pem")), args[2]);
        try {
            String version = packs.install("litigation-visual");
            check(packs.isReady("litigation-visual"), "Signed Graphviz pack not ready");
            Path graph = packs.componentDir("litigation-visual", "graphviz").orElseThrow();
            Path input = root.resolve("synthetic.dot"), output = root.resolve("synthetic.svg");
            Files.writeString(input, "digraph acceptance { missing -> installed -> usable; }");
            run(root, "graphviz.log", List.of(graph.resolve("bin/dot.exe").toString(), "-Tsvg", input.toString(), "-o", output.toString()), 30);
            check(Files.readString(output).contains("<svg"), "Graphviz produced no SVG");
            write(root, "pack.json", Map.of("id", "litigation-visual", "version", version, "ready", true));
        } finally { packs.shutdown(); }
        write(root, "core-passed.json", Map.of("passed", true, "pages", 2, "pdfBytes", pdf.length,
                "limitations", List.of("Windows Server hosted runner, not consumer Windows", "No interactive UAC or Electron UI", "No Docker daemon/container", "No model inference", "Rendered pages require human visual review")));
    }
}
