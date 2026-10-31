export function createUI({ output = process.stdout, errorOutput = process.stderr, env = process.env } = {}) {
  const color = Boolean(output.isTTY && env.TERM !== "dumb" && env.NO_COLOR === undefined);
  const paint = (code, text) => color ? `\x1b[${code}m${text}\x1b[0m` : text;
  const secrets = new Set();
  const clean = (value) => {
    let text = String(value);
    for (const secret of secrets) text = text.replaceAll(secret, "[REDACTED]");
    return text;
  };
  const write = (text) => output.write(clean(text));
  const duration = (start) => `${((Date.now() - start) / 1000).toFixed(1)}s`;

  return {
    addSecret(value) {
      if (value?.trim()) secrets.add(value.trim());
    },
    header() {
      const width = Math.max(30, Math.min(54, (output.columns || 80) - 4));
      const row = (text) => `  ${paint("36", "│")}  ${text.padEnd(width - 2)}${paint("36", "│")}\n`;
      write(`\n  ${paint("36", `╭${"─".repeat(width)}╮`)}\n`);
      write(row("SEKAI GATEWAY"));
      write(row("/mytoken · OpenCode"));
      write(`  ${paint("36", `╰${"─".repeat(width)}╯`)}\n`);
      write(`  ${paint("2", "Plugin diuji sebelum dipasang.")}\n\n`);
    },
    section(number, label) {
      write(`  ${paint("36", `[${number}/6]`)} ${label}\n`);
    },
    note(text) {
      write(`        ${paint("2", text)}\n`);
    },
    async step(number, label, action) {
      const start = Date.now();
      const frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
      let index = 0;
      let timer;
      if (color) {
        const draw = () => write(`\r\x1b[2K  ${paint("36", frames[index++ % frames.length])} [${number}/6] ${label}`);
        draw();
        timer = setInterval(draw, 90);
        timer.unref();
      } else {
        write(`  [${number}/6] ${label}…\n`);
      }
      try {
        const result = await action();
        if (timer) clearInterval(timer);
        write(`${color ? "\r\x1b[2K" : ""}  ${paint("32", color ? "✓" : "[OK]")} [${number}/6] ${label} ${paint("2", `(${duration(start)})`)}\n`);
        return result;
      } catch (error) {
        if (timer) clearInterval(timer);
        write(`${color ? "\r\x1b[2K" : ""}  ${paint("31", color ? "✗" : "[GAGAL]")} [${number}/6] ${label}\n`);
        throw error;
      }
    },
    success(result) {
      write(`\n  ${paint("32;1", "Instalasi berhasil. /mytoken siap digunakan.")}\n\n`);
      write(`  Endpoint   ${result.version} ${result.version === "v2" ? "· Coding Plan" : "· PAYG / paket token"}\n`);
      write(`  Plugin     ${result.plugin}\n`);
      write(`  Pengaturan ${result.settings}\n`);
      if (result.backup) write(`  Backup     ${result.backup}\n`);
      write(`\n  Mulai ulang OpenCode, lalu jalankan ${paint("36;1", "/mytoken")}.\n\n`);
    },
    error(error) {
      const message = error.name === "AbortError" ? "Instalasi dibatalkan." :
        error.code ? `Instalasi gagal (${error.code}). Periksa izin file dan jalankan kembali.` : error.message;
      errorOutput.write(clean(`\n  ${paint("31;1", message)}\n`));
      if (error.details) {
        // Keep failures useful while suppressing normal npm output and secrets.
        const details = clean(error.details).replace(/\x1b\[[0-9;]*[A-Za-z]/g, "").trim().split("\n").slice(-30);
        errorOutput.write(details.map((line) => `    ${line}`).join("\n") + "\n");
      }
      errorOutput.write("\n");
    },
  };
}
