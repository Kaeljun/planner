import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Plus,
  Upload,
  Download,
  Sun,
  Moon,
  Trash2,
  CheckSquare,
  Square,
  ChevronRight,
  ChevronDown,
  Pencil,
  ListPlus,
} from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";

const STORAGE_KEY = "studyPlanner:v3";
const THEME_KEY = "studyPlanner:theme";

function uid() {
  return Math.random().toString(36).slice(2, 7);
}

function useTheme() {
  const [theme, setTheme] = useState(() => {
    const saved = localStorage.getItem(THEME_KEY);
    if (saved) return saved;
    return window.matchMedia &&
      window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
  });
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem(THEME_KEY, theme);
  }, [theme]);
  const toggle = () => setTheme((t) => (t === "dark" ? "light" : "dark"));
  return { theme, toggle };
}

function useItems() {
  const [items, setItems] = useState(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed)
        ? parsed.map((it) => ({
            ...it,
            children: Array.isArray(it.children) ? it.children : [],
          }))
        : [];
    } catch {
      return [];
    }
  });
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  }, [items]);
  return [items, setItems];
}

function calcSubStat(it) {
  const total = it.children.length;
  const done = it.children.filter((s) => s.studied).length;
  return { done, total, pct: total ? Math.round((done / total) * 100) : 0 };
}

function detectDelimiter(text) {
  const first = text.split(/\r?\n/).find((l) => l.trim().length > 0) || "";
  const c = (first.match(/,/g) || []).length;
  const s = (first.match(/;/g) || []).length;
  return s > c ? ";" : ",";
}

function parseCSV(text) {
  if (!text) return [];
  const delim = detectDelimiter(text);
  const rows = [];
  let cur = "";
  let inside = false;
  let row = [];
  const push = () => {
    row.push(cur);
    cur = "";
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];
    if (ch == '"') {
      if (inside && next == '"') {
        cur += '"';
        i++;
      } else inside = !inside;
    } else if (ch === delim && !inside) {
      push();
    } else if ((ch == "\n" || ch == "\r") && !inside) {
      if (ch == "\r" && next == "\n") {
        i++;
      }
      push();
      rows.push(row);
      row = [];
    } else {
      cur += ch;
    }
  }
  if (cur.length > 0 || row.length > 0) {
    push();
    rows.push(row);
  }
  return rows
    .map((r) => r.map((c) => c.trim()))
    .filter((r) => r.some((c) => c !== ""));
}

function mapCSVToItems(rows) {
  if (rows.length === 0) return [];
  const header = rows[0].map((h) => h.toLowerCase());
  let data = rows;
  let idxName = -1,
    idxStatus = -1,
    idxSub = -1;
  const headerLike = [
    "disciplina",
    "matéria",
    "materia",
    "nome",
    "assunto",
    "subject",
  ];
  const statusLike = ["status", "situacao", "situação", "done", "estudada"];
  const subLike = ["subdisciplina", "sub", "submatéria", "submateria"];
  if (
    header.some(
      (h) =>
        headerLike.includes(h) || statusLike.includes(h) || subLike.includes(h)
    )
  ) {
    idxName = header.findIndex((h) => headerLike.includes(h));
    idxStatus = header.findIndex((h) => statusLike.includes(h));
    idxSub = header.findIndex((h) => subLike.includes(h));
    data = rows.slice(1);
  } else {
    idxName = 0;
    idxStatus = rows[0].length > 1 ? 1 : -1;
    idxSub = -1;
  }

  const out = [];
  for (const r of data) {
    let name = r[idxName] || "";
    if (!name.trim()) continue;
    let sub = idxSub > -1 ? r[idxSub] || "" : "";
    if (!sub) {
      const parts = name
        .split(">")
        .map((s) => s.trim())
        .filter(Boolean);
      if (parts.length > 1) {
        name = parts[0];
        sub = parts.slice(1).join(" > ");
      }
    }
    let studied = false;
    if (idxStatus > -1) {
      const s = (r[idxStatus] || "").toString().toLowerCase();
      studied =
        ["1", "true", "sim", "feito", "done", "estudada", "estudado"].includes(
          s
        ) || s.startsWith("estud");
    }
    out.push({ name: name.trim(), sub: sub.trim(), studied });
  }
  return out;
}

function toCSV(items) {
  const esc = (v) => '"' + String(v).replaceAll('"', '""') + '"';
  const lines = ["disciplina,subdisciplina,status"];
  for (const it of items) {
    if (it.children.length === 0) {
      lines.push(esc(it.name) + ",," + (it.studied ? "estudada" : "pendente"));
    } else {
      for (const ch of it.children) {
        lines.push(
          esc(it.name) +
            "," +
            esc(ch.name) +
            "," +
            (ch.studied ? "estudada" : "pendente")
        );
      }
    }
  }
  return lines.join("\n");
}

export default function App() {
  const { theme, toggle } = useTheme();
  const [items, setItems] = useItems();
  const [filter, setFilter] = useState("all");
  const [q, setQ] = useState("");
  const [expanded, setExpanded] = useState(() => new Set());

  const bulkDlg = useRef(null);
  const bulkText = useRef(null);
  const importDlg = useRef(null);
  const csvText = useRef(null);
  const subDlg = useRef(null);
  const subText = useRef(null);
  const subFor = useRef({ id: "", name: "" });

  const ensureItem = (it) => ({
    id: it.id || uid(),
    name: (it.name || "").trim(),
    studied: !!it.studied,
    createdAt: it.createdAt || new Date().toISOString(),
    children: Array.isArray(it.children) ? it.children : [],
  });

  const addOne = (name, studied = false) => {
    name = (name || "").trim();
    if (!name) return false;
    if (items.some((i) => i.name.toLowerCase() === name.toLowerCase()))
      return false;
    setItems((prev) => [...prev, ensureItem({ name, studied })]);
    return true;
  };

  const addSub = (parentId, name, studied = false) => {
    setItems((prev) =>
      prev.map((p) => {
        if (p.id !== parentId) return p;
        if (
          p.children.some(
            (c) => c.name.toLowerCase() === name.trim().toLowerCase()
          )
        )
          return p;
        const children = [
          ...p.children,
          { id: uid(), name: name.trim(), studied: !!studied },
        ];
        const studiedParent = children.length
          ? children.every((x) => x.studied)
          : p.studied;
        return { ...p, children, studied: studiedParent };
      })
    );
  };

  const removeOne = (id) => setItems((prev) => prev.filter((i) => i.id !== id));

  const removeSub = (parentId, subId) =>
    setItems((prev) =>
      prev.map((p) => {
        if (p.id !== parentId) return p;
        const children = p.children.filter((c) => c.id !== subId);
        const studiedParent = children.length
          ? children.every((x) => x.studied)
          : p.studied;
        return { ...p, children, studied: studiedParent };
      })
    );

  const setStudied = (id, val) =>
    setItems((prev) =>
      prev.map((it) => {
        if (it.id !== id) return it;
        const children = it.children.map((c) => ({ ...c, studied: !!val }));
        return { ...it, studied: !!val, children };
      })
    );

  const setSubStudied = (parentId, subId, val) =>
    setItems((prev) =>
      prev.map((p) => {
        if (p.id !== parentId) return p;
        const children = p.children.map((c) =>
          c.id === subId ? { ...c, studied: !!val } : c
        );
        const studiedParent = children.length
          ? children.every((x) => x.studied)
          : p.studied;
        return { ...p, children, studied: studiedParent };
      })
    );

  const renameOne = (id, newName) =>
    setItems((prev) =>
      prev.map((it) =>
        it.id === id ? { ...it, name: (newName || "").trim() } : it
      )
    );
  const renameSub = (parentId, subId, newName) =>
    setItems((prev) =>
      prev.map((p) =>
        p.id === parentId
          ? {
              ...p,
              children: p.children.map((c) =>
                c.id === subId ? { ...c, name: (newName || "").trim() } : c
              ),
            }
          : p
      )
    );

  const markAll = (val) =>
    setItems((prev) =>
      prev.map((i) => ({
        ...i,
        studied: !!val,
        children: i.children.map((c) => ({ ...c, studied: !!val })),
      }))
    );
  const clearAll = () => {
    if (confirm("Tem certeza que deseja apagar todas as disciplinas?"))
      setItems([]);
  };

  const toggleExpand = (id) =>
    setExpanded((prev) => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });

  const filtered = React.useMemo(() => {
    const qq = q.trim().toLowerCase();
    const flt = items
      .filter((it) => {
        const okFilter =
          filter === "all" || (filter === "done" ? it.studied : !it.studied);
        const matchSelf = !qq || it.name.toLowerCase().includes(qq);
        const matchChild =
          !qq || it.children.some((c) => c.name.toLowerCase().includes(qq));
        return okFilter && (matchSelf || matchChild);
      })
      .sort((a, b) => {
        if (a.studied !== b.studied) return a.studied - b.studied;
        return a.name.localeCompare(b.name, "pt-BR", { sensitivity: "base" });
      });
    return flt;
  }, [items, filter, q]);

  const counters = React.useMemo(() => {
    const total = items.length;
    const done = items.filter((i) => i.studied).length;
    const pct = total ? Math.round((done / total) * 100) : 0;
    return { total, done, pct };
  }, [items]);

  const [preview, setPreview] = useState("");
  const onCSVPreview = (text) => {
    const rows = parseCSV(text);
    const mapped = mapCSVToItems(rows);
    const incoming = mapped.length;
    if (incoming === 0) {
      setPreview("");
      return;
    }
    const existingNames = new Set(items.map((i) => i.name.toLowerCase()));
    const parents = new Set();
    let subs = 0;
    for (const it of mapped) {
      parents.add(it.name.toLowerCase());
      if (it.sub) subs++;
    }
    const newParents = [...parents].filter((p) => !existingNames.has(p)).length;
    setPreview(
      `${incoming} linhas detectadas • ${newParents} disciplina(s) nova(s) • ${subs} subdisciplina(s).`
    );
  };

  const doImport = (text) => {
    const rows = parseCSV(text);
    const mapped = mapCSVToItems(rows);
    if (mapped.length === 0) return;
    setItems((prev) => {
      const byName = new Map(prev.map((i) => [i.name.toLowerCase(), i]));
      const out = [...prev];
      for (const rec of mapped) {
        const key = rec.name.toLowerCase();
        let parent = byName.get(key);
        if (!parent) {
          parent = ensureItem({
            name: rec.name,
            studied: rec.sub ? false : rec.studied,
          });
          out.push(parent);
          byName.set(key, parent);
        }
        if (rec.sub) {
          const exists = parent.children.find(
            (c) => c.name.toLowerCase() === rec.sub.toLowerCase()
          );
          if (!exists) {
            parent.children.push({
              id: uid(),
              name: rec.sub,
              studied: !!rec.studied,
            });
          }
          parent.studied = parent.children.every((x) => x.studied);
        } else if (rec.studied) {
          parent.studied = true;
        }
      }
      return out.map(ensureItem);
    });
  };

  const doExport = () => {
    if (items.length === 0) {
      alert("Nada para exportar.");
      return;
    }
    const csv = toCSV(items);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "disciplinas.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  const openBulk = () => {
    bulkText.current.value = "";
    bulkDlg.current.showModal();
  };
  const confirmBulk = () => {
    const lines = (bulkText.current.value || "")
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean);
    let added = 0;
    for (const line of lines) {
      if (addOne(line, false)) added++;
    }
    bulkDlg.current.close();
    if (added === 0) alert("Nada foi adicionado (duplicatas?)");
  };

  const openSubDlg = (it) => {
    subFor.current = it;
    subText.current.value = "";
    subDlg.current.showModal();
  };
  const confirmSub = () => {
    const p = subFor.current;
    if (!p?.id) return;
    const lines = (subText.current.value || "")
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean);
    let added = 0;
    for (const line of lines) {
      addSub(p.id, line, false);
      added++;
    }
    subDlg.current.close();
    if (added === 0) alert("Nenhuma subdisciplina adicionada.");
  };

  const openImport = () => {
    csvText.current.value = preview ? csvText.current.value : "";
    setPreview("");
    importDlg.current.showModal();
  };
  const confirmImport = () => {
    const txt = csvText.current.value || "";
    doImport(txt);
    setPreview("");
    importDlg.current.close();
  };

  const onDropCSV = (ev) => {
    ev.preventDefault();
    const f =
      ev.dataTransfer && ev.dataTransfer.files && ev.dataTransfer.files[0];
    if (f && /\.csv$/i.test(f.name)) {
      const r = new FileReader();
      r.onload = () => {
        openImport();
        csvText.current.value = r.result;
        onCSVPreview(r.result);
      };
      r.readAsText(f);
    }
  };

  return (
    <div
      className="min-h-screen bg-[var(--bg)] text-[var(--text)]"
      onDragOver={(e) => e.preventDefault()}
      onDrop={onDropCSV}
    >
      <header className="sticky top-0 z-10 bg-[var(--panel)]/95 backdrop-blur border-b border-[var(--border)] shadow-lg">
        <div className="mx-auto max-w-[1200px] px-4 py-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h1 className="text-lg font-semibold">
                Planejador de Disciplinas
              </h1>
              <p className="text-xs text-[var(--muted)]">
                Adicione matérias, subdisciplinas, marque como estudadas e
                importe/exporte via CSV. Tudo salvo no navegador.
              </p>
            </div>
            <button
              onClick={toggle}
              className="inline-flex items-center gap-2 rounded-xl border border-[var(--border)] px-3 py-2 hover:-translate-y-0.5 transition"
            >
              {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
              <span className="text-sm">Tema</span>
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1200px] px-4 pb-10">
        <section className="mt-4 space-y-3">
          <div className="grid md:grid-cols-[1fr_auto] gap-3">
            <div className="flex gap-2">
              <AddOne onAdd={addOne} />
            </div>
            <div className="flex flex-wrap gap-2 justify-end">
              <button className="btn" onClick={openBulk}>
                <Plus size={16} /> Em massa
              </button>
              <button className="btn" onClick={openImport}>
                <Upload size={16} /> Importar CSV
              </button>
              <button className="btn" onClick={doExport}>
                <Download size={16} /> Exportar
              </button>
              <button className="btn ok" onClick={() => markAll(true)}>
                <CheckSquare size={16} /> Marcar todas
              </button>
              <button className="btn warn" onClick={() => markAll(false)}>
                <Square size={16} /> Desmarcar
              </button>
              <button className="btn danger" onClick={clearAll}>
                <Trash2 size={16} /> Limpar
              </button>
            </div>
          </div>

          <div className="rounded-2xl border border-[var(--border)] bg-[var(--panel)] p-3 shadow">
            <div className="flex flex-wrap items-center gap-2">
              <Seg value={filter} onChange={setFilter} />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Pesquisar…"
                className="ml-2 flex-1 rounded-xl border border-[var(--border)] bg-transparent px-3 py-2 outline-none"
              />
              <span className="text-xs text-[var(--muted)] hidden md:block">
                Dica: arraste um CSV para importar.
              </span>
            </div>
            <div className="mt-2 flex items-center gap-3 text-xs text-[var(--muted)]">
              <div className="h-2 w-full overflow-hidden rounded-full border border-[var(--border)] bg-black/20 dark:bg-white/10">
                <div
                  className="h-full bg-gradient-to-r from-blue-500 to-emerald-500 transition-[width] duration-300"
                  style={{ width: counters.pct + "%" }}
                />
              </div>
              <div>
                {counters.done} de {counters.total} estudadas ({counters.pct}%)
              </div>
            </div>
          </div>
        </section>

        <section className="mt-4 rounded-2xl border border-[var(--border)] bg-[var(--panel)] shadow">
          {filtered.length === 0 ? (
            <div className="p-6 text-center text-[var(--muted)]">
              Sem disciplinas ainda. Adicione acima ou importe um CSV.
            </div>
          ) : (
            <ul className="divide-y divide-[var(--border)]">
              <AnimatePresence initial={false}>
                {filtered.map((it) => (
                  <motion.li
                    key={it.id}
                    layout
                    initial={{ opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -4 }}
                    transition={{ duration: 0.18 }}
                    className="relative"
                  >
                    <div
                      className={`grid grid-cols-[auto_auto_1fr_auto] items-center gap-3 p-3 ${
                        it.studied ? "opacity-80" : ""
                      }`}
                    >
                      <button
                        aria-label="Expandir"
                        onClick={() => toggleExpand(it.id)}
                        className="h-6 w-6 rounded-md border border-[var(--border)] flex items-center justify-center"
                      >
                        {expanded.has(it.id) ? (
                          <ChevronDown size={16} />
                        ) : (
                          <ChevronRight size={16} />
                        )}
                      </button>
                      <input
                        type="checkbox"
                        checked={!!it.studied}
                        onChange={(e) => setStudied(it.id, e.target.checked)}
                        className="h-4 w-4"
                      />
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="chip">#{it.id}</span>
                        <span
                          className={`truncate ${
                            it.studied ? "line-through" : ""
                          }`}
                        >
                          {it.name}
                        </span>
                        <span className="chip">
                          {calcSubStat(it).done}/{calcSubStat(it).total}
                        </span>
                      </div>
                      <div className="flex gap-1">
                        <button
                          className="btn ghost"
                          onClick={() => openSubDlg(it)}
                          title="Adicionar subdisciplinas"
                        >
                          <ListPlus size={16} />
                        </button>
                        <button
                          className="btn ghost"
                          onClick={() => {
                            const nn = prompt("Novo nome", it.name) || "";
                            if (nn.trim()) renameOne(it.id, nn);
                          }}
                          title="Renomear"
                        >
                          <Pencil size={16} />
                        </button>
                        <button
                          className="btn ghost"
                          onClick={() => removeOne(it.id)}
                          title="Excluir"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </div>

                    <motion.div
                      layout
                      initial={false}
                      animate={{
                        height: expanded.has(it.id) ? "auto" : 0,
                        opacity: expanded.has(it.id) ? 1 : 0,
                      }}
                      transition={{ duration: 0.25 }}
                      style={{ overflow: "hidden" }}
                    >
                      <ul className="space-y-1 border-t border-dashed border-[var(--border)] bg-[var(--sub-bg)] px-3 py-2">
                        <AnimatePresence initial={false}>
                          {(!q
                            ? it.children
                            : it.children.filter((c) =>
                                c.name.toLowerCase().includes(q.toLowerCase())
                              )
                          )
                            .sort((a, b) => {
                              if (a.studied !== b.studied)
                                return a.studied - b.studied;
                              return a.name.localeCompare(b.name, "pt-BR", {
                                sensitivity: "base",
                              });
                            })
                            .map((ch) => (
                              <motion.li
                                key={ch.id}
                                layout
                                initial={{ opacity: 0, x: -4 }}
                                animate={{ opacity: 1, x: 0 }}
                                exit={{ opacity: 0, x: -4 }}
                                transition={{ duration: 0.18 }}
                                className={`grid grid-cols-[auto_1fr_auto] items-center gap-3 px-1 py-1 ${
                                  ch.studied ? "opacity-80" : ""
                                }`}
                              >
                                <input
                                  type="checkbox"
                                  checked={!!ch.studied}
                                  onChange={(e) =>
                                    setSubStudied(
                                      it.id,
                                      ch.id,
                                      e.target.checked
                                    )
                                  }
                                  className="h-4 w-4"
                                />
                                <span
                                  className={`truncate ${
                                    ch.studied ? "line-through" : ""
                                  }`}
                                >
                                  {ch.name}
                                </span>
                                <div className="flex gap-1">
                                  <button
                                    className="btn ghost"
                                    onClick={() => {
                                      const nn =
                                        prompt(
                                          "Novo nome da subdisciplina",
                                          ch.name
                                        ) || "";
                                      if (nn.trim())
                                        renameSub(it.id, ch.id, nn);
                                    }}
                                    title="Renomear"
                                  >
                                    <Pencil size={16} />
                                  </button>
                                  <button
                                    className="btn ghost"
                                    onClick={() => removeSub(it.id, ch.id)}
                                    title="Excluir"
                                  >
                                    <Trash2 size={16} />
                                  </button>
                                </div>
                              </motion.li>
                            ))}
                        </AnimatePresence>
                      </ul>
                    </motion.div>
                  </motion.li>
                ))}
              </AnimatePresence>
            </ul>
          )}
        </section>

        <details className="mt-4 rounded-2xl border border-[var(--border)] bg-[var(--panel)] p-3">
          <summary className="cursor-pointer text-sm text-[var(--muted)]">
            Como importar CSV?
          </summary>
          <div className="mt-2 text-sm space-y-2">
            <p>Formatos aceitos:</p>
            <ul className="list-disc pl-5 space-y-1">
              <li>
                Sem cabeçalho: <code>Matemática</code> (uma por linha) ou{" "}
                <code>Matemática,Estudada</code>
              </li>
              <li>
                Com cabeçalho (qualquer ordem): <code>disciplina,status</code> —
                status: <em>estudada/pendente</em> (ou{" "}
                <em>true/false, sim/não, done/todo</em>).
              </li>
              <li>
                Com subdisciplinas:
                <ul className="list-disc pl-5">
                  <li>
                    Colunas: <code>disciplina,subdisciplina,status</code>
                  </li>
                  <li>
                    Ou caminho único em <code>disciplina</code>:{" "}
                    <code>
                      Direito Administrativo &gt; Processo Administrativo
                    </code>
                  </li>
                </ul>
              </li>
            </ul>
            <p>
              Separador vírgula ou ponto e vírgula. Campos podem estar entre
              aspas.
            </p>
            <pre className="rounded-lg bg-black/20 p-3 text-xs overflow-auto">
              {`disciplina,subdisciplina,status
Direito Administrativo,Organização administrativa,pendente
Direito Administrativo,Processo administrativo,estudada
Administração Pública,,pendente`}
            </pre>
          </div>
        </details>
      </main>

      <dialog ref={bulkDlg} className="dialog">
        <div className="dlg-head">
          <strong>Adicionar em massa</strong>
          <button className="btn ghost" onClick={() => bulkDlg.current.close()}>
            Fechar
          </button>
        </div>
        <div className="dlg-body">
          <p>
            Insira uma disciplina por linha. Linhas em branco serão ignoradas.
          </p>
          <textarea
            ref={bulkText}
            placeholder={
              "Ex.:\\nDireito Constitucional\\nDireito Administrativo\\nPortuguês"
            }
            className="textarea"
          ></textarea>
        </div>
        <div className="dlg-foot">
          <button className="btn" onClick={() => bulkDlg.current.close()}>
            Cancelar
          </button>
          <button className="btn primary" onClick={confirmBulk}>
            Adicionar
          </button>
        </div>
      </dialog>

      <dialog ref={importDlg} className="dialog">
        <div className="dlg-head">
          <strong>Importar CSV</strong>
          <button
            className="btn ghost"
            onClick={() => importDlg.current.close()}
          >
            Fechar
          </button>
        </div>
        <div className="dlg-body space-y-2">
          <label htmlFor="file" className="drop">
            Selecione um arquivo CSV
          </label>
          <input
            id="file"
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              const r = new FileReader();
              r.onload = () => {
                csvText.current.value = r.result;
                onCSVPreview(r.result);
              };
              r.readAsText(f);
            }}
          />
          <p>Ou cole o conteúdo abaixo:</p>
          <textarea
            ref={csvText}
            placeholder="Cole aqui o CSV…"
            onInput={(e) => onCSVPreview(e.currentTarget.value)}
            className="textarea"
          ></textarea>
          <div className="text-xs text-[var(--muted)]">{preview}</div>
        </div>
        <div className="dlg-foot">
          <button className="btn" onClick={() => importDlg.current.close()}>
            Cancelar
          </button>
          <button
            className="btn primary"
            onClick={confirmImport}
            disabled={!preview}
          >
            Importar
          </button>
        </div>
      </dialog>

      <dialog ref={subDlg} className="dialog">
        <div className="dlg-head">
          <strong>Adicionar subdisciplinas</strong>
          <button className="btn ghost" onClick={() => subDlg.current.close()}>
            Fechar
          </button>
        </div>
        <div className="dlg-body">
          <p>
            Insira uma subdisciplina por linha para{" "}
            <strong>{subFor.current?.name}</strong>.
          </p>
          <textarea
            ref={subText}
            placeholder={
              "Ex.:\\nProcesso administrativo\\nAtos administrativos\\nLicitações"
            }
            className="textarea"
          ></textarea>
        </div>
        <div className="dlg-foot">
          <button className="btn" onClick={() => subDlg.current.close()}>
            Cancelar
          </button>
          <button className="btn primary" onClick={confirmSub}>
            Adicionar
          </button>
        </div>
      </dialog>
    </div>
  );
}

function AddOne({ onAdd }) {
  const [val, setVal] = useState("");
  const submit = () => {
    if (onAdd(val, false)) {
      setVal("");
    }
  };
  return (
    <div className="flex w-full gap-2">
      <input
        value={val}
        onChange={(e) => setVal(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            submit();
          }
        }}
        placeholder="Adicionar disciplina (Enter)"
        className="flex-1 rounded-xl border border-[var(--border)] bg-transparent px-3 py-2 outline-none"
      />
      <button className="btn primary" onClick={submit}>
        <Plus size={16} /> Adicionar
      </button>
    </div>
  );
}

function Seg({ value, onChange }) {
  const Btn = ({ v, children }) => (
    <button
      onClick={() => onChange(v)}
      aria-pressed={value === v}
      className={`px-3 py-2 rounded-lg border ${
        value === v ? "bg-[var(--chip)]" : "bg-transparent"
      } border-[var(--border)]`}
    >
      {children}
    </button>
  );
  return (
    <div className="inline-flex gap-1">
      <Btn v="all">Todas</Btn>
      <Btn v="pending">Pendentes</Btn>
      <Btn v="done">Estudadas</Btn>
    </div>
  );
}
