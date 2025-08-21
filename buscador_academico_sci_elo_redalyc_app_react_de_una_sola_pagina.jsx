  import React, { useMemo, useState } from "react";
  import { motion } from "framer-motion";
  import { Search, Loader2, ExternalLink, Database, Filter, Calendar, Globe, BookOpen } from "lucide-react";
  
  /**
   * Buscador académico minimalista que consulta:
   *  - Redalyc vía OAI-PMH (XML) usando un proxy CORS (configurable)
   *  - SciELO vía Crossref (para artículos con DOI de SciELO) como solución práctica mientras se conecta ArticleMeta
   *
   * Notas importantes:
   * 1) Redalyc expone OAI-PMH. Aquí usamos su endpoint público como ejemplo y lo consultamos mediante un proxy CORS de demostración.
 *    Cambia REDALYC_OAI_BASE y CORS_PROXY por los de tu infraestructura (ideal: un pequeño proxy propio/Cloudflare Worker).
 * 2) SciELO ofrece APIs (ArticleMeta/CitedBy). Para búsquedas por palabra clave, este ejemplo usa Crossref filtrando prefijos SciELO (p. ej. 10.1590).
 *    Si luego conectas ArticleMeta, rellena SCIELO_API_BASE y adapta fetchScielo.
 * 3) Todo corre 100% en el navegador.
 */

// === Configuración ===
const CORS_PROXY = "https://r.jina.ai/http/"; // proxy de solo lectura (renderiza HTML/XML como texto). Para producción: usa tu propio proxy.
const REDALYC_OAI_BASE = "http://148.215.1.70/redalyc/oai"; // Página oficial de OAI Redalyc lista ejemplos con este host.

// Prefijos de DOI comunes en SciELO (no exhaustivo, pero práctico para un MVP)
const SCIELO_DOI_PREFIXES = ["10.1590", "10.4025", "10.11606", "10.18634", "10.17533"]; // puedes ampliar esta lista

// === Utilidades ===
const fmt = (d) => (d ? new Date(d).toISOString().slice(0, 10) : "");

function useQuery() {
  const [q, setQ] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [srcRedalyc, setSrcRedalyc] = useState(true);
  const [srcScielo, setSrcScielo] = useState(true);
  return { q, setQ, from, setFrom, to, setTo, srcRedalyc, setSrcRedalyc, srcScielo, setSrcScielo };
}

// Parser de OAI-PMH (oai_dc) a objetos simples
function parseOaiDc(xmlString) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlString, "text/xml");
  const records = Array.from(doc.getElementsByTagName("record"));
  return records.map((rec) => {
    const dc = rec.getElementsByTagName("metadata")[0]?.getElementsByTagName("dc:dc")[0];
    const getAll = (tag) => Array.from(dc?.getElementsByTagName(tag) || []).map((n) => n.textContent.trim());
    const title = getAll("dc:title")[0] || "(sin título)";
    const creators = getAll("dc:creator");
    const subjects = getAll("dc:subject");
    const date = getAll("dc:date")[0] || "";
    const identifiers = getAll("dc:identifier");
    const doi = identifiers.find((id) => id.startsWith("10.")) || "";
    const url = identifiers.find((id) => id.startsWith("http")) || "";
    const source = getAll("dc:source")[0] || "Redalyc";
    return { id: url || doi || title, title, authors: creators, subjects, date, doi, url, journal: source, source: "Redalyc" };
  });
}

// === Fetchers ===
async function fetchRedalyc({ q, from, to, page = 1, pageSize = 50 }) {
  // OAI-PMH no busca por palabra clave; listamos registros por fecha y filtramos client-side por palabra en título/subjects
  const params = new URLSearchParams({ verb: "ListRecords", metadataPrefix: "oai_dc" });
  if (from) params.set("from", from);
  if (to) params.set("until", to);
  // Nota: algunos endpoints usan 'until' otros aceptan 'to' — OAI-PMH usa 'until'

  const url = `${CORS_PROXY}${encodeURIComponent(`${REDALYC_OAI_BASE}?${params.toString()}`)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error("Error consultando Redalyc OAI-PMH");
  const xml = await res.text();
  let items = parseOaiDc(xml);
  if (q) {
    const regex = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    items = items.filter((it) => regex.test(it.title) || it.subjects?.some((s) => regex.test(s)));
  }
  // Paginación simple en cliente
  const start = (page - 1) * pageSize;
  const paged = items.slice(start, start + pageSize);
  return { items: paged, total: items.length };
}

async function fetchScieloViaCrossref({ q, from, to, rows = 50 }) {
  // Usamos Crossref para localizar DOIs con prefijos típicos de SciELO
  const filter = [from ? `from-pub-date:${from}` : null, to ? `until-pub-date:${to}` : null]
    .filter(Boolean)
    .join(",");
  const prefixQuery = SCIELO_DOI_PREFIXES.map((p) => `prefix:${p}`).join(",");
  const params = new URLSearchParams({ query: q || "", rows: String(rows) });
  if (filter) params.set("filter", filter + (prefixQuery ? "," + prefixQuery : ""));
  else if (prefixQuery) params.set("filter", prefixQuery);

  const url = `https://api.crossref.org/works?${params.toString()}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error("Error consultando Crossref para SciELO");
  const json = await res.json();
  const items = (json.message.items || []).map((w) => {
    const title = Array.isArray(w.title) ? w.title[0] : w.title || "(sin título)";
    const authors = (w.author || []).map((a) => [a.given, a.family].filter(Boolean).join(" ")).filter(Boolean);
    const dateParts = w.issued?.["date-parts"]?.[0] || [];
    const date = dateParts.length ? `${dateParts[0]}-${String(dateParts[1] || 1).padStart(2, "0")}-${String(dateParts[2] || 1).padStart(2, "0")}` : "";
    const doi = w.DOI;
    const journal = (w["container-title"] || [])[0] || "";
    const url = w.URL || (doi ? `https://doi.org/${doi}` : "");
    return { id: doi || url || title, title, authors, date, doi, url, journal, source: "SciELO (vía Crossref)" };
  });
  return { items, total: json.message.totalResults || items.length };
}

// === Componentes UI ===
function Badge({ children }) {
  return <span className="inline-flex items-center rounded-2xl px-3 py-1 text-xs border shadow-sm">{children}</span>;
}

function ResultCard({ r }) {
  return (
    <motion.div layout className="rounded-2xl border p-4 shadow-sm hover:shadow-md">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-lg font-semibold leading-snug mb-1">{r.title}</h3>
          <div className="text-sm opacity-80 mb-2">{r.authors?.join(", ")}</div>
          <div className="flex flex-wrap gap-2 mb-2">
            {r.journal && <Badge><BookOpen className="w-3 h-3 mr-1" />{r.journal}</Badge>}
            {r.date && <Badge><Calendar className="w-3 h-3 mr-1" />{r.date}</Badge>}
            <Badge><Database className="w-3 h-3 mr-1" />{r.source}</Badge>
          </div>
        </div>
        <a href={r.url || (r.doi ? `https://doi.org/${r.doi}` : "#")} target="_blank" rel="noreferrer" className="shrink-0 inline-flex items-center gap-1 text-sm underline">
          Abrir <ExternalLink className="w-4 h-4" />
        </a>
      </div>
    </motion.div>
  );
}

export default function App() {
  const q = useQuery();
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState([]);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState("");

  const canSearch = useMemo(() => (q.srcRedalyc || q.srcScielo) && (q.q.trim().length > 0 || q.srcRedalyc), [q.srcRedalyc, q.srcScielo, q.q]);

  const onSearch = async (e) => {
    e?.preventDefault();
    if (!canSearch) return;
    setBusy(true); setError("");
    try {
      const tasks = [];
      if (q.srcRedalyc) tasks.push(fetchRedalyc({ q: q.q.trim(), from: q.from, to: q.to }));
      if (q.srcScielo) tasks.push(fetchScieloViaCrossref({ q: q.q.trim(), from: q.from, to: q.to }));
      const data = await Promise.allSettled(tasks);
      const coll = data.flatMap((d) => (d.status === "fulfilled" ? d.value.items : []));
      const ttl = data.reduce((s, d) => s + (d.status === "fulfilled" ? d.value.total : 0), 0);
      setResults(coll);
      setTotal(ttl);
    } catch (err) {
      console.error(err);
      setError(err.message || "Ocurrió un error");
    } finally { setBusy(false); }
  };

  return (
    <div className="min-h-screen bg-white text-gray-900">
      <div className="max-w-5xl mx-auto p-6">
        <header className="mb-6">
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight mb-2">Buscador académico (Redalyc + SciELO)</h1>
          <p className="opacity-80">Consulta Redalyc vía OAI-PMH y artículos de SciELO (vía DOIs en Crossref). Configurable para conectar ArticleMeta más adelante.</p>
        </header>

        <form onSubmit={onSearch} className="grid gap-3 md:grid-cols-12 items-end">
          <div className="md:col-span-6">
            <label className="block text-sm mb-1">Consulta</label>
            <input value={q.q} onChange={(e) => q.setQ(e.target.value)} placeholder="palabras clave, título, tema..." className="w-full rounded-2xl border px-4 py-2" />
          </div>
          <div className="md:col-span-2">
            <label className="block text-sm mb-1">Desde</label>
            <input type="date" value={q.from} onChange={(e) => q.setFrom(e.target.value)} className="w-full rounded-2xl border px-4 py-2" />
          </div>
          <div className="md:col-span-2">
            <label className="block text-sm mb-1">Hasta</label>
            <input type="date" value={q.to} onChange={(e) => q.setTo(e.target.value)} className="w-full rounded-2xl border px-4 py-2" />
          </div>
          <div className="md:col-span-2 flex gap-2 items-center">
            <button disabled={busy || !canSearch} className="inline-flex items-center gap-2 rounded-2xl border px-4 py-2 shadow-sm disabled:opacity-50">
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />} Buscar
            </button>
          </div>

          <div className="md:col-span-12 flex flex-wrap items-center gap-3 mt-2">
            <span className="inline-flex items-center gap-2 text-sm"><Filter className="w-4 h-4" /> Fuentes:</span>
            <label className="inline-flex items-center gap-2"><input type="checkbox" checked={q.srcRedalyc} onChange={(e) => q.setSrcRedalyc(e.target.checked)} /> Redalyc (OAI-PMH)</label>
            <label className="inline-flex items-center gap-2"><input type="checkbox" checked={q.srcScielo} onChange={(e) => q.setSrcScielo(e.target.checked)} /> SciELO (vía Crossref)</label>
          </div>
        </form>

        <main className="mt-6">
          {error && (
            <div className="rounded-2xl border border-red-300 bg-red-50 p-3 mb-4 text-sm">
              {error}
            </div>
          )}

          <div className="flex items-center justify-between mb-3">
            <div className="text-sm opacity-80">Resultados: <strong>{total}</strong></div>
          </div>

          <div className="grid gap-3">
            {results.map((r) => <ResultCard key={r.id} r={r} />)}
            {!busy && results.length === 0 && (
              <div className="rounded-2xl border p-6 text-center opacity-80">Sin resultados todavía. Ingresa una consulta y presiona Buscar.</div>
            )}
          </div>
        </main>

        <footer className="mt-10 text-xs opacity-70 leading-relaxed">
          <p className="mb-2">Consejos:
            <br/>• Para Redalyc, OAI-PMH devuelve XML en lotes por fecha; aquí se filtra por palabra clave en el cliente. Si necesitas búsqueda semántica, conviene un índice propio (p. ej., Elasticsearch) poblado desde OAI-PMH.
            <br/>• Para SciELO, este MVP usa Crossref para localizar artículos con DOIs de SciELO. Puedes conectar <em>ArticleMeta</em> cuando definas el endpoint.
          </p>
          <p className="mt-2 flex items-center gap-1"><Globe className="w-3 h-3" /> Hecho para ejecutarse como página estática (no requiere servidor).
          </p>
        </footer>
      </div>
    </div>
  );
}
