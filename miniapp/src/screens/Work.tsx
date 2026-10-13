import { t } from "../i18n";
import { useState } from "react";
import { haptic } from "../tg";
import { Head } from "../ui";
import Career from "./Career";
import Study from "./Study";

/**
 * «Дело» — учёба и свои проекты под одной вкладкой: и то и другое про работу головой,
 * а пять вкладок на телефоне уже предел.
 */
export default function Work() {
  const [part, setPart] = useState<"study" | "career">(() => {
    try {
      return localStorage.getItem("work") === "career" ? "career" : "study";
    } catch {
      return "study";
    }
  });

  const choose = (p: "study" | "career") => {
    haptic();
    setPart(p);
    try {
      localStorage.setItem("work", p);
    } catch { /* приватный режим, не критично */ }
  };

  return (
    <>
      <Head
        title={t("Дело")}
        right={
          <div className="seg">
            {([["study", t("Учёба")], ["career", t("Проекты")]] as const).map(([id, label]) => (
              <button key={id} className={part === id ? "on" : undefined} aria-pressed={part === id} onClick={() => choose(id)}>
                {label}
              </button>
            ))}
          </div>
        }
      />
      {part === "study" ? <Study /> : <Career />}
    </>
  );
}
