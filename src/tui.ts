import { Plugin } from "@opencode/plugin/tui";
import { createElement, setProp, type JSX } from "@opentui/solid";
import { createEffect, createSignal } from "solid-js";
import { UsageError, usageReport } from "./usage.js";
import { monitorText, startUsageMonitor, type UsageState } from "./monitor.js";

export default Plugin.define({
  id: "sekai.mytoken",
  setup(context) {
    const [state, setState] = createSignal<UsageState>({ loading: true });
    const monitor = startUsageMonitor({ onChange: setState });
    const renderUsage = () => {
      // Use OpenTUI's native renderer helpers so the distributed JavaScript
      // needs no additional JSX transform or separate bundled UI runtime.
      const text = createElement("text");
      setProp(text, "fg", context.theme.text.base);
      setProp(text, "wrapMode", "word");
      setProp(text, "paddingLeft", 1);
      setProp(text, "paddingRight", 1);
      createEffect(() => setProp(text, "content", monitorText(state())));
      return text as unknown as JSX.Element;
    };
    const removeHome = context.ui.slot({ before: "home.footer", render: renderUsage });
    const removeComposer = context.ui.slot({ append: "session.composer.top", render: renderUsage });
    const stopSucceeded = context.data.on("session.execution.succeeded", monitor.requestRefresh);
    const stopFailed = context.data.on("session.execution.failed", monitor.requestRefresh);
    let loading = false;
    context.keymap.layer(() => ({
      mode: "global",
      commands: [{
        id: "sekai.mytoken.show",
        title: "Cek usage Sekai Gateway",
        group: "Sekai Gateway",
        palette: true,
        slash: { name: "mytoken", arguments: true },
        async run(input) {
          if (loading) return;
          loading = true;
          context.ui.toast.show({ message: "Mengambil usage Sekai Gateway…", variant: "info" });
          let message: string;
          try {
            message = await usageReport(input);
          } catch (error) {
            context.ui.toast.show({
              title: "/mytoken",
              message: error instanceof UsageError ? error.message : "Gagal mengambil usage Sekai Gateway.",
              variant: "error",
              duration: 7000,
            });
            return;
          } finally {
            loading = false;
          }
          const sections = message.split("\n\n").map((section) => {
            const [title, ...details] = section.split("\n");
            return { title, description: details.join(" · "), value: section };
          });
          // The built-in selection dialog scrolls on short terminals. Keep each
          // detail alert small enough to fit without custom rendering code.
          while (true) {
            const selected = await context.ui.dialog.select({
              title: "/mytoken · Pilih bagian untuk detail",
              options: sections,
            });
            if (selected === undefined) return;
            await context.ui.dialog.alert({ title: "/mytoken", message: selected });
          }
        },
      }],
    }));
    return () => {
      monitor.dispose();
      stopSucceeded();
      stopFailed();
      removeHome();
      removeComposer();
    };
  },
});
