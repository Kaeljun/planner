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

/* =================== Persistência / Tema =================== */
const STORAGE_KEY = "studyPlanner:v6";
const THEME_KEY = "studyPlanner:theme";
const uid = () => Math.random().toString(36).slice(2, 7);

function useTheme() {
  const [theme, setTheme] = useState(
    () =>
      localStorage.getItem(THEME_KEY) ??
      (window.matchMedia?.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light")
  );
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem(THEME_KEY, theme);
  }, [theme]);
  return {
    theme,
    toggle: () => setTheme((t) => (t === "dark" ? "light" : "dark")),
  };
}

function normalize(nodes) {
  const walk = (n) => {
    const children = n.children?.map(walk) ?? [];
    const studied = children.length
      ? children.every((c) => c.studied)
      : !!n.studied;
    return { ...n, studied, children };
  };
  return nodes.map(walk);
}

function useItems() {
  const [items, setItems] = useState(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      const ensure = (n) => ({
        id: n.id || uid(),
        name: (n.name || "").trim(),
        studied: !!n.studied,
        children: Array.isArray(n.children) ? n.children.map(ensure) : [],
      });
      return normalize(Array.isArray(parsed) ? parsed.map(ensure) : []);
    } catch {
      return [];
    }
  });
  useEffect(
    () => localStorage.setItem(STORAGE_KEY, JSON.stringify(items)),
    [items]
  );
  return [items, setItems];
}

/* =================== CSV helpers =================== */
const detectDelimiter = (t) => {
  const first = t.split(/\r?\n/).find((l) => l.trim()) || "";
  const vc = (first.match(/,/g) || []).length,
    sc = (first.match(/;/g) || []).length;
  return sc > vc ? ";" : ",";
};
function parseCSV(text) {
  if (!text) return [];
  const delim = detectDelimiter(text);
  const rows = [];
  let cur = "",
    inside = false,
    row = [];
  const push = () => {
    row.push(cur);
    cur = "";
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i],
      nx = text[i + 1];
    if (ch == '"') {
      if (inside && nx == '"') {
        cur += '"';
        i++;
      } else inside = !inside;
    } else if (ch === delim && !inside) {
      push();
    } else if ((ch == "\n" || ch == "\r") && !inside) {
      if (ch == "\r" && nx == "\n") i++;
      push();
      rows.push(row);
      row = [];
    } else cur += ch;
  }
  if (cur.length > 0 || row.length > 0) {
    push();
    rows.push(row);
  }
  return rows
    .map((r) => r.map((c) => c.trim()))
    .filter((r) => r.some((c) => c !== ""));
}
function mapCSV(rows) {
  if (rows.length === 0) return [];
  const header = rows[0].map((h) => h.toLowerCase());
  let data = rows,
    idxName = -1,
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
    let subPath = idxSub > -1 ? r[idxSub] || "" : "";
    if (!subPath) {
      const parts = name
        .split(">")
        .map((s) => s.trim())
        .filter(Boolean);
      if (parts.length > 1) {
        name = parts[0];
        subPath = parts.slice(1).join(" > ");
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
    out.push({ name: name.trim(), subPath: subPath.trim(), studied });
  }
  return out;
}
function toCSV(items) {
  const esc = (v) => '"' + String(v).replaceAll('"', '""') + '"';
  const lines = ["disciplina,subdisciplina,status"];
  const dfs = (parentPath, node) => {
    if (!node.children.length) {
      if (parentPath)
        lines.push(
          esc(parentPath) +
            "," +
            esc(node.name) +
            "," +
            (node.studied ? "estudada" : "pendente")
        );
      else
        lines.push(
          esc(node.name) + ",," + (node.studied ? "estudada" : "pendente")
        );
      return;
    }
    for (const ch of node.children) {
      const p = parentPath ? `${parentPath} > ${node.name}` : node.name;
      dfs(p, ch);
    }
  };
  for (const it of items) dfs("", it);
  return lines.join("\n");
}

/* =================== helpers =================== */
const calcSubStat = (n) => ({
  done: n.children.filter((s) => s.studied).length,
  total: n.children.length,
});
const addChild = (nodes, parentId, name) =>
  nodes.map((n) =>
    n.id === parentId
      ? {
          ...n,
          children: [
            ...n.children,
            { id: uid(), name: name.trim(), studied: false, children: [] },
          ],
        }
      : { ...n, children: addChild(n.children, parentId, name) }
  );
const removeNode = (nodes, id) =>
  nodes
    .filter((n) => n.id !== id)
    .map((n) => ({ ...n, children: removeNode(n.children, id) }));
const setStudiedCascade = (nodes, id, val) => {
  const mark = (m) => ({
    ...m,
    studied: !!val,
    children: m.children.map(mark),
  });
  const step = (arr) =>
    arr.map((n) =>
      n.id === id ? mark(n) : { ...n, children: step(n.children) }
    );
  return normalize(step(nodes));
};
const renameNode = (nodes, id, newName) =>
  nodes.map((n) =>
    n.id === id
      ? { ...n, name: newName.trim() }
      : { ...n, children: renameNode(n.children, id, newName) }
  );

/* =================== App =================== */
export default function App() {
  const { theme, toggle } = useTheme();
  const [items, setItems] = useItems();
  const [filter, setFilter] = useState("all");
  const [q, setQ] = useState("");

  // "Apenas uma aberta por nível": Map<parentKey, childId>
  const [openByParent, setOpenByParent] = useState(() => new Map());
  const isOpen = (parentKey, id) => openByParent.get(parentKey) === id;
  const idToNode = useMemo(() => {
    const map = new Map();
    const walk = (n) => {
      map.set(n.id, n);
      n.children.forEach(walk);
    };
    items.forEach(walk);
    return map;
  }, [items]);
  const collectSubtreeIds = (rootId) => {
    const root = idToNode.get(rootId);
    const out = [];
    if (!root) return out;
    (function dfs(n) {
      out.push(n.id);
      n.children.forEach(dfs);
    })(root);
    return out;
  };
  const toggleOpen = (parentKey, id) => {
    setOpenByParent((prev) => {
      const next = new Map(prev);
      const cur = next.get(parentKey);
      const clearSubtree = (rid) => {
        for (const sid of collectSubtreeIds(rid)) next.delete(sid);
      };
      if (cur === id) {
        next.delete(parentKey);
        clearSubtree(id);
      } else {
        if (cur) clearSubtree(cur);
        next.set(parentKey, id);
      }
      return next;
    });
  };

  // Dialogs / inputs
  const bulkDlg = useRef(null),
    bulkText = useRef(null);
  const importDlg = useRef(null),
    csvText = useRef(null);
  const subDlg = useRef(null),
    subText = useRef(null),
    subFor = useRef({ id: "", name: "" });

  const addOne = (name) => {
    const nm = (name || "").trim();
    if (!nm) return false;
    if (items.some((i) => i.name.toLowerCase() === nm.toLowerCase()))
      return false;
    setItems((prev) => [
      ...prev,
      { id: uid(), name: nm, studied: false, children: [] },
    ]);
    return true;
  };
  const onCheck = (id, checked) =>
    setItems((prev) => setStudiedCascade(prev, id, checked));
  const onRename = (id, current) => {
    const nn = prompt("Novo nome", current) || "";
    if (nn.trim()) setItems((p) => renameNode(p, id, nn));
  };
  const onRemove = (id) => setItems((prev) => removeNode(prev, id));
  const addSub = (parentId, name) =>
    setItems((prev) => normalize(addChild(prev, parentId, name)));

  // Import/Export
  const [preview, setPreview] = useState("");
  const onCSVPreview = (text) => {
    const rows = parseCSV(text),
      recs = mapCSV(rows);
    if (recs.length === 0) {
      setPreview("");
      return;
    }
    const existing = new Set(items.map((i) => i.name.toLowerCase()));
    const parents = new Set();
    let lines = 0;
    for (const r of recs) {
      parents.add(r.name.toLowerCase());
      lines++;
    }
    const newParents = [...parents].filter((p) => !existing.has(p)).length;
    setPreview(
      `${lines} linhas detectadas • ${newParents} disciplina(s) nova(s).`
    );
  };
  const doImport = (text) => {
    const rows = parseCSV(text),
      recs = mapCSV(rows);
    if (recs.length === 0) return;
    setItems((prev) => {
      const map = new Map(prev.map((i) => [i.name.toLowerCase(), i]));
      const out = structuredClone(prev);
      const ensureChild = (parent, name) => {
        let child = parent.children.find(
          (c) => c.name.toLowerCase() === name.toLowerCase()
        );
        if (!child) {
          child = { id: uid(), name, studied: false, children: [] };
          parent.children.push(child);
        }
        return child;
      };
      for (const r of recs) {
        let parent = map.get(r.name.toLowerCase());
        if (!parent) {
          parent = { id: uid(), name: r.name, studied: false, children: [] };
          out.push(parent);
          map.set(r.name.toLowerCase(), parent);
        }
        if (r.subPath) {
          const parts = r.subPath
            .split(">")
            .map((s) => s.trim())
            .filter(Boolean);
          let cur = parent;
          parts.forEach((seg, i) => {
            cur = ensureChild(cur, seg);
            if (i === parts.length - 1 && r.studied) cur.studied = true;
          });
        } else if (r.studied) {
          parent.studied = true;
        }
      }
      return normalize(out);
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

  // Filtro/busca
  const matches = (n, qq) =>
    n.name.toLowerCase().includes(qq) || n.children.some((c) => matches(c, qq));
  const filtered = useMemo(() => {
    const qq = q.trim().toLowerCase();
    return items
      .filter(
        (it) =>
          (filter === "all" ||
            (filter === "done" ? it.studied : !it.studied)) &&
          (!qq || matches(it, qq))
      )
      .sort((a, b) =>
        a.studied !== b.studied
          ? a.studied - b.studied
          : a.name.localeCompare(b.name, "pt-BR", { sensitivity: "base" })
      );
  }, [items, filter, q]);

  const counters = useMemo(() => {
    const total = items.length,
      done = items.filter((i) => i.studied).length;
    return { total, done, pct: total ? Math.round((done / total) * 100) : 0 };
  }, [items]);

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
    for (const l of lines) {
      if (addOne(l)) added++;
    }
    bulkDlg.current.close();
    if (added === 0) alert("Nada foi adicionado (duplicatas?)");
  };
  const openSubDlg = (node) => {
    subFor.current = node;
    subText.current.value = "";
    subDlg.current.showModal();
  };
  const confirmSub = () => {
    const p = subFor.current;
    if (!p?.id) return;
    (subText.current.value || "")
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean)
      .forEach((l) => setItems((prev) => normalize(addChild(prev, p.id, l))));
    subDlg.current.close();
  };
  const openImport = () => {
    csvText.current.value = "";
    setPreview("");
    importDlg.current.showModal();
  };
  const confirmImport = () => {
    doImport(csvText.current.value || "");
    setPreview("");
    importDlg.current.close();
  };
  const onDropCSV = (ev) => {
    ev.preventDefault();
    const f = ev.dataTransfer?.files?.[0];
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
                3 níveis, CSV e progresso salvo localmente.
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
        {/* Toolbar */}
        <section className="mt-4 space-y-3">
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--panel)] p-3 shadow toolbar">
            <div className="flex flex-wrap items-center gap-2">
              <AddOne onAdd={addOne} />
              <div className="flex flex-wrap gap-2 ml-auto">
                <button className="btn" onClick={openBulk}>
                  <Plus size={16} /> Em massa
                </button>
                <button className="btn" onClick={openImport}>
                  <Upload size={16} /> Importar CSV
                </button>
                <button className="btn" onClick={doExport}>
                  <Download size={16} /> Exportar
                </button>
                <button
                  className="btn ok"
                  onClick={() =>
                    setItems((prev) =>
                      normalize(
                        prev.map((i) => setStudiedCascade([i], i.id, true)[0])
                      )
                    )
                  }
                >
                  <CheckSquare size={16} /> Marcar todas
                </button>
                <button
                  className="btn warn"
                  onClick={() =>
                    setItems((prev) =>
                      normalize(
                        prev.map((i) => setStudiedCascade([i], i.id, false)[0])
                      )
                    )
                  }
                >
                  <Square size={16} /> Desmarcar
                </button>
                <button
                  className="btn danger"
                  onClick={() => {
                    if (confirm("Apagar todas?")) setItems([]);
                  }}
                >
                  <Trash2 size={16} /> Limpar
                </button>
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-[var(--border)] bg-[var(--panel)] p-3 shadow">
            <div className="flex flex-wrap items-center gap-2">
              <Seg value={filter} onChange={setFilter} />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Pesquisar…"
                className="ml-2 flex-1 rounded-xl border border-[var(--border)] bg-transparent px-3 py-1.5 text-sm h-9 outline-none"
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

        {/* Lista */}
        <section className="mt-4 rounded-2xl border border-[var(--border)] bg-[var(--panel)] shadow">
          {filtered.length === 0 ? (
            <div className="p-6 text-center text-[var(--muted)]">
              Sem disciplinas ainda. Adicione acima ou importe um CSV.
            </div>
          ) : (
            <ul className="divide-y divide-[var(--border)]">
              <AnimatePresence initial={false}>
                {filtered.map((node) => (
                  <NodeRow
                    key={node.id}
                    node={node}
                    depth={1}
                    parentKey="root"
                    isOpen={isOpen}
                    toggleOpen={toggleOpen}
                    onCheck={onCheck}
                    onRename={onRename}
                    onAddSub={openSubDlg}
                    onRemove={onRemove}
                  />
                ))}
              </AnimatePresence>
            </ul>
          )}
        </section>
      </main>

      {/* Dialogs */}
      <dialog ref={bulkDlg} className="dialog">
        <div className="dlg-head">
          <strong>Adicionar em massa</strong>
          <button className="btn ghost" onClick={() => bulkDlg.current.close()}>
            Fechar
          </button>
        </div>
        <div className="dlg-body">
          <p>Uma disciplina por linha.</p>
          <textarea
            ref={bulkText}
            className="textarea"
            placeholder={
              "Ex.:\nDireito Constitucional\nDireito Administrativo\nPortuguês"
            }
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
            Uma subdisciplina por linha para{" "}
            <strong>{subFor.current?.name}</strong>.
          </p>
          <textarea
            ref={subText}
            className="textarea"
            placeholder={
              "Ex.:\nProcesso administrativo\nAtos administrativos\nLicitações"
            }
          ></textarea>
        </div>
        <div className="dlg-foot">
          <button className="btn" onClick={() => subDlg.current.close()}>
            Cancelar
          </button>
          <button
            className="btn primary"
            onClick={() => {
              const p = subFor.current;
              if (!p?.id) return;
              (subText.current.value || "")
                .split(/\r?\n/)
                .map((s) => s.trim())
                .filter(Boolean)
                .forEach((l) =>
                  setItems((prev) => normalize(addChild(prev, p.id, l)))
                );
              subDlg.current.close();
            }}
          >
            Adicionar
          </button>
        </div>
      </dialog>
    </div>
  );
}

/* =================== Nó recursivo =================== */
function NodeRow({
  node,
  depth,
  parentKey,
  isOpen,
  toggleOpen,
  onCheck,
  onRename,
  onAddSub,
  onRemove,
}) {
  const open = isOpen(parentKey, node.id);
  const nextParentKey = node.id;
  const hasChildren = node.children.length > 0;

  // classes de nível para fundo/tinta
  const levelClass = depth >= 4 ? "level-4" : depth === 3 ? "level-3" : "";

  return (
    <motion.li
      layout
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -4 }}
      transition={{ duration: 0.18 }}
      className="relative"
    >
      <div
        className={`row grid grid-cols-[auto_auto_1fr_auto] items-center gap-3 p-3 ${
          node.studied ? "opacity-80" : ""
        } ${levelClass}`}
      >
        {/* Expander: só se tiver filhos */}
        {hasChildren ? (
          <button
            aria-label="Expandir"
            onClick={() => toggleOpen(parentKey, node.id)}
            className="expander h-6 w-6 rounded-md border border-[var(--border)] flex items-center justify-center"
          >
            {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
          </button>
        ) : (
          <span className="h-6 w-6 inline-block" aria-hidden="true" />
        )}

        <input
          type="checkbox"
          checked={!!node.studied}
          onChange={(e) => onCheck(node.id, e.target.checked)}
          className="h-4 w-4"
        />

        {/* Coluna do título com gutter à esquerda (apenas para depth>1) */}
        <div
          className={`content-wrap depth-${depth} flex items-center gap-2 min-w-0 ${
            depth > 1 ? "text-sm" : ""
          }`}
        >
          {depth > 1 && (
            <div className={`gutter depth-${depth}`} aria-hidden="true" />
          )}
          {depth === 1 && <span className="chip">#{node.id}</span>}
          <span className={`truncate ${node.studied ? "line-through" : ""}`}>
            {node.name}
          </span>
          <span className="chip">
            {calcSubStat(node).done}/{calcSubStat(node).total}
          </span>
        </div>

        <div className="flex gap-1">
          {depth < 4 && (
            <button
              className="btn ghost"
              title="Adicionar subdisciplina"
              onClick={() => onAddSub(node)}
            >
              <ListPlus size={16} />
            </button>
          )}
          <button
            className="btn ghost"
            title="Renomear"
            onClick={() => onRename(node.id, node.name)}
          >
            <Pencil size={16} />
          </button>
          <button
            className="btn ghost danger-ghost"
            title="Excluir"
            onClick={() => onRemove(node.id)}
          >
            <Trash2 size={16} />
          </button>
        </div>
      </div>

      <motion.div
        layout
        initial={false}
        animate={{
          height: open && hasChildren ? "auto" : 0,
          opacity: open && hasChildren ? 1 : 0,
        }}
        transition={{ duration: 0.25 }}
        style={{ overflow: "hidden" }}
      >
        {hasChildren && (
          <ul
            className={`border-t border-b border-dashed border-[var(--border)] ${
              depth === 1 ? "bg-[var(--sub-bg)]" : ""
            }`}
          >
            {node.children
              .sort((a, b) =>
                a.studied !== b.studied
                  ? a.studied - b.studied
                  : a.name.localeCompare(b.name, "pt-BR", {
                      sensitivity: "base",
                    })
              )
              .map((child) => (
                <NodeRow
                  key={child.id}
                  node={child}
                  depth={depth + 1}
                  parentKey={nextParentKey}
                  isOpen={isOpen}
                  toggleOpen={toggleOpen}
                  onCheck={onCheck}
                  onRename={onRename}
                  onAddSub={onAddSub}
                  onRemove={onRemove}
                />
              ))}
          </ul>
        )}
      </motion.div>
    </motion.li>
  );
}

/* =================== Controles =================== */
function AddOne({ onAdd }) {
  const [val, setVal] = useState("");
  const submit = () => {
    if (onAdd(val)) setVal("");
  };
  return (
    <div className="flex w-full gap-2 min-w-0">
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
        className="flex-1 min-w-0 rounded-xl border border-[var(--border)] bg-transparent px-3 py-1.5 text-sm h-9 outline-none"
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
