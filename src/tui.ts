import { Plugin } from "@opencode/plugin/tui";
import { UsageError, usageReport } from "./usage.js";

export default Plugin.define({
  id: "sekai.mytoken",
  setup(context) {
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
  },
});
