
"use strict";

const $ = (selector) => document.querySelector(selector);

const state = {
  documents: [],
  mode: "keyword",
  searches: 0,
  activities: []
};

const samples = [
  {
    name: "pattern-search-notes.txt",
    content: `String matching is used to find a pattern inside a larger text. The Knuth Morris Pratt algorithm preprocesses the pattern using a prefix table. Boyer Moore compares characters from right to left and can skip sections of the text. Hashing is the key idea behind Rabin Karp. Efficient pattern search is useful in document retrieval and text editors.`
  },
  {
    name: "document-indexing.txt",
    content: `An inverted index maps each term to the documents that contain it. Indexing reduces the amount of text scanned during keyword search. A search engine can rank documents using term frequency and inverse document frequency. Text preprocessing may include tokenization, stop word removal, and normalization. Efficient indexing improves retrieval time.`
  },
  {
    name: "similarity-analysis.txt",
    content: `Document similarity compares two pieces of text to estimate how closely their content matches. Exact phrase matching finds a sequence of words in the same order. Keyword search is more flexible because terms can appear in different positions. Similarity scores are useful indicators, but they are not proof of plagiarism. Matching passages should be reviewed in context.`
  },
  {
    name: "algorithm-comparison.txt",
    content: `Boyer Moore and Knuth Morris Pratt are string matching algorithms. KMP uses a prefix table to avoid repeating comparisons after a mismatch. Boyer Moore uses bad character and good suffix shifts. Rabin Karp uses rolling hash values to compare a pattern with text windows. Their performance depends on pattern length and text characteristics.`
  }
];

let toastTimer;

function escapeHTML(value) {
  return String(value).replace(/[&<>"']/g, character => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[character]);
}

function normalize(text) {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

function tokenize(text) {
  return normalize(text).match(/[a-z0-9]+/g) || [];
}

function showToast(message) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("show"), 2600);
}

function addActivity(title, detail, symbol = "•") {
  state.activities.unshift({ title, detail, symbol });
  state.activities = state.activities.slice(0, 4);

  $("#activity-list").innerHTML = state.activities.map(item => `
    <div class="activity-item">
      <span class="activity-icon">${escapeHTML(item.symbol)}</span>
      <div>
        <b>${escapeHTML(item.title)}</b>
        <p>${escapeHTML(item.detail)}</p>
      </div>
    </div>
  `).join("");
}

function formatSize(bytes) {
  if (!bytes) return "Text document";
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

function renderFiles() {
  $("#doc-count").textContent = state.documents.length;
  $("#file-count").textContent =
    `${state.documents.length} ${state.documents.length === 1 ? "file" : "files"}`;

  if (!state.documents.length) {
    $("#file-list").innerHTML = `
      <div class="empty-files">
        No documents added yet.
        <br>
        <button class="text-button" id="load-samples">Load sample files</button>
      </div>`;
    $("#load-samples").addEventListener("click", loadSamples);
    return;
  }

  $("#file-list").innerHTML = state.documents.map((doc, index) => `
    <div class="file-row">
      <span class="file-icon">▤</span>
      <div class="file-meta">
        <b title="${escapeHTML(doc.name)}">${escapeHTML(doc.name)}</b>
        <small>${formatSize(doc.size || new Blob([doc.content]).size)} · Ready to search</small>
      </div>
      <button class="remove-file" data-index="${index}"
        aria-label="Remove ${escapeHTML(doc.name)}" title="Remove file">×</button>
    </div>
  `).join("");

  $("#file-list").querySelectorAll(".remove-file").forEach(button => {
    button.addEventListener("click", () => {
      const removed = state.documents.splice(Number(button.dataset.index), 1)[0];
      renderFiles();
      renderClusters();
      renderDuplicates(false);
      addActivity("Document removed", removed.name, "×");
      showToast("Document removed from this session.");
    });
  });
}

function addDocuments(files) {
  let added = 0;

  for (const file of files) {
    if (!file.content.trim()) continue;

    const alreadyExists = state.documents.some(doc =>
      doc.name === file.name && doc.content === file.content
    );

    if (!alreadyExists) {
      state.documents.push(file);
      added++;
    }
  }

  renderFiles();
  renderClusters();
  renderDuplicates(false);

  if (added) {
    addActivity("Documents added", `${added} file(s) ready to search`, "+");
    showToast(`${added} document(s) added.`);
  } else {
    showToast("No new readable documents were added.");
  }
}

function loadSamples() {
  const existingNames = new Set(state.documents.map(doc => doc.name));
  const newSamples = samples
    .filter(doc => !existingNames.has(doc.name))
    .map(doc => ({ ...doc, size: new Blob([doc.content]).size }));

  if (!newSamples.length) {
    showToast("Sample files are already loaded.");
    return;
  }

  addDocuments(newSamples);
}

function readFiles(fileList) {
  const files = Array.from(fileList);
  const accepted = files.filter(file => /\.(txt|md|text)$/i.test(file.name));

  if (accepted.length !== files.length) {
    showToast("This prototype supports TXT and Markdown files only.");
  }

  if (!accepted.length) return;

  Promise.all(accepted.map(file => new Promise(resolve => {
    const reader = new FileReader();

    reader.onload = () => resolve({
      name: file.name,
      content: String(reader.result || ""),
      size: file.size
    });

    reader.onerror = () => resolve(null);
    reader.readAsText(file);
  }))).then(results => addDocuments(results.filter(Boolean)));
}

/*
 * Keyword score:
 * 78% query-term coverage + 22% capped term-frequency contribution.
 * This is an illustrative lexical score, not semantic similarity.
 */
function scoreDocument(doc, query, mode) {
  const text = normalize(doc.content);
  const normalizedQuery = normalize(query);

  if (mode === "exact") {
    const index = text.indexOf(normalizedQuery);
    return {
      score: index >= 0 ? 100 : 0,
      index,
      matched: index >= 0,
      found: []
    };
  }

  const terms = [...new Set(tokenize(query))];

  if (!terms.length) {
    return { score: 0, index: -1, matched: false, found: [] };
  }

  const docTerms = tokenize(doc.content);
  const docTermSet = new Set(docTerms);
  const found = terms.filter(term => docTermSet.has(term));

  const coverage = found.length / terms.length;
  const frequency = found.reduce((sum, term) =>
    sum + Math.min(3, docTerms.filter(word => word === term).length), 0
  );

  const density = frequency / (terms.length * 3);
  const score = Math.round((coverage * 0.78 + density * 0.22) * 100);

  let index = -1;
  for (const term of found) {
    const position = text.indexOf(term);
    if (position >= 0 && (index < 0 || position < index)) {
      index = position;
    }
  }

  return { score, index, matched: found.length > 0, found };
}

function makeSnippet(doc, info, query, mode) {
  const content = doc.content.replace(/\s+/g, " ").trim();
  const position = Math.max(0, info.index);
  const start = Math.max(0, position - 75);
  const end = Math.min(content.length, start + 230);

  let snippet =
    (start > 0 ? "…" : "") +
    content.slice(start, end) +
    (end < content.length ? "…" : "");

  let safe = escapeHTML(snippet);

  const terms = mode === "exact"
    ? [query]
    : [...new Set(tokenize(query))].sort((a, b) => b.length - a.length);

  for (const term of terms) {
    if (!term) continue;

    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    safe = safe.replace(new RegExp(`(${escaped})`, "ig"), "<mark>$1</mark>");
  }

  return safe;
}

function runSearch(event) {
  event.preventDefault();

  const query = $("#query").value.trim();

  if (!query) {
    showToast("Enter some search terms first.");
    $("#query").focus();
    return;
  }

  if (!state.documents.length) {
    showToast("Upload documents or load the sample collection first.");
    return;
  }

  state.searches++;
  $("#search-count").textContent = state.searches;

  const results = state.documents
    .map(doc => ({ doc, info: scoreDocument(doc, query, state.mode) }))
    .filter(item => state.mode === "exact"
      ? item.info.matched
      : item.info.score > 0)
    .sort((a, b) => b.info.score - a.info.score);

  const modeName = {
    keyword: "Keyword search",
    exact: "Exact phrase",
    text: "Text comparison"
  }[state.mode];

  let html = `
    <div class="results-head">
      <b>${results.length} matching document(s)</b>
      <span>${modeName} · highest score first</span>
    </div>`;

  if (!results.length) {
    html += `<div class="no-results">No matching documents found.
      Try fewer keywords or a different phrase.</div>`;
  } else {
    html += results.map(({ doc, info }) => `
      <article class="result-card">
        <div class="result-title-row">
          <div class="result-title">
            <span>▤</span><b>${escapeHTML(doc.name)}</b>
          </div>
          <span class="score">${info.score}% match</span>
        </div>
        <p class="snippet">${makeSnippet(doc, info, query, state.mode)}</p>
        <div class="result-meta">
          <span>${state.mode === "exact"
            ? "Exact phrase found"
            : `${info.found.length} query term(s) found`}</span>
          <span>${doc.content.length.toLocaleString()} characters</span>
        </div>
      </article>
    `).join("");
  }

  $("#results").innerHTML = html;
  addActivity("Search completed", `"${query.slice(0, 40)}" · ${results.length} result(s)`, "⌕");
}

function setMode(mode) {
  state.mode = mode;

  document.querySelectorAll(".tab").forEach(tab => {
    tab.classList.toggle("active", tab.dataset.mode === mode);
  });

  const settings = {
    keyword: {
      label: "Search terms",
      placeholder: "e.g. pattern search, indexing, algorithms",
      hint: "Find documents containing one or more keywords."
    },
    exact: {
      label: "Exact phrase",
      placeholder: "Enter the exact sequence of words...",
      hint: "Only return documents containing this phrase in the same order."
    },
    text: {
      label: "Text to compare",
      placeholder: "Paste a passage or enter a few sentences...",
      hint: "Compare the words in your text against each document. This is lexical, not semantic, similarity."
    }
  }[mode];

  $("#search-form label").textContent = settings.label;
  $("#query").placeholder = settings.placeholder;
  $("#search-hint").textContent = settings.hint;
}

function getDuplicatePairs() {
  const pairs = [];

  for (let i = 0; i < state.documents.length; i++) {
    for (let j = i + 1; j < state.documents.length; j++) {
      if (
        normalize(state.documents[i].content) ===
        normalize(state.documents[j].content)
      ) {
        pairs.push([state.documents[i], state.documents[j]]);
      }
    }
  }

  return pairs;
}

function renderDuplicates(showNotification = true) {
  const pairs = getDuplicatePairs();

  $("#dupe-count").textContent = pairs.length;
  $("#duplicate-number").textContent = pairs.length;

  const status = $("#dupe-status");
  status.textContent = pairs.length
    ? "Review needed"
    : state.documents.length
      ? "No exact duplicates"
      : "Not checked";

  status.classList.toggle("good", state.documents.length > 0 && pairs.length === 0);

  $("#duplicate-results").innerHTML = pairs.length
    ? pairs.map(([first, second]) => `
        <div class="dupe-pair">
          <span>↔</span>
          <div><b>${escapeHTML(first.name)}</b><br>
            matches <b>${escapeHTML(second.name)}</b>
          </div>
        </div>
      `).join("")
    : `<p class="hint">${state.documents.length
        ? "No exact duplicate text found."
        : "Add documents to run a duplicate check."}</p>`;

  if (showNotification) {
    addActivity("Duplicate check completed", `${pairs.length} matching pair(s)`, "▢");
    showToast(`${pairs.length} exact duplicate pair(s) found.`);
  }

  return pairs;
}

function renderClusters() {
  const docs = state.documents;

  if (!docs.length) {
    $("#group-count").textContent = "—";
    $("#cluster-stats").innerHTML =
      '<div class="empty-chart">◎<p>Add documents to preview groups.</p></div>';
    return;
  }

  const groups = [
    {
      name: "Algorithms & search",
      terms: ["algorithm", "search", "pattern", "kmp", "boyer", "rabin", "hash"],
      color: "c1"
    },
    {
      name: "Similarity & text",
      terms: ["similarity", "document", "phrase", "text", "match", "plagiarism"],
      color: "c2"
    },
    {
      name: "Indexing & retrieval",
      terms: ["index", "retrieval", "keyword", "token", "ranking", "engine"],
      color: "c3"
    }
  ];

  const counts = groups.map(group => ({
    ...group,
    count: docs.filter(doc =>
      group.terms.some(term => normalize(doc.content).includes(term))
    ).length
  })).filter(group => group.count > 0);

  $("#group-count").textContent = counts.length;

  $("#cluster-stats").innerHTML = counts.map(group => {
    const percent = Math.round(group.count / docs.length * 100);

    return `
      <div class="cluster-row">
        <div>
          <div class="cluster-label">
            <b>${escapeHTML(group.name)}</b><span>${percent}%</span>
          </div>
          <div class="cluster-bar">
            <div class="cluster-fill ${group.color}" style="width:${percent}%"></div>
          </div>
        </div>
        <span class="cluster-count">${group.count} doc(s)</span>
      </div>`;
  }).join("");
}

function navigate(target, label) {
  $("#breadcrumb").textContent = label;

  document.querySelectorAll(".nav-item").forEach(button => {
    button.classList.toggle("active", button.dataset.target === target);
  });

  const element = target === "overview"
    ? $("#overview")
    : target === "search"
      ? $("#search")
      : target === "duplicates"
        ? $("#duplicates")
        : $("#clusters");

  element.scrollIntoView({ behavior: "smooth", block: "start" });
}

/* Upload and drag-and-drop */
const fileInput = $("#file-input");
const dropZone = $("#drop-zone");

$("#browse").addEventListener("click", () => fileInput.click());

$("#add-top").addEventListener("click", () => {
  $("#upload").scrollIntoView({ behavior: "smooth", block: "center" });
  fileInput.click();
});

dropZone.addEventListener("click", event => {
  if (event.target.id !== "browse") fileInput.click();
});

dropZone.addEventListener("keydown", event => {
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    fileInput.click();
  }
});

fileInput.addEventListener("change", () => {
  readFiles(fileInput.files);
  fileInput.value = "";
});

["dragenter", "dragover"].forEach(type => {
  dropZone.addEventListener(type, event => {
    event.preventDefault();
    dropZone.classList.add("drag-over");
  });
});

["dragleave", "drop"].forEach(type => {
  dropZone.addEventListener(type, event => {
    event.preventDefault();
    dropZone.classList.remove("drag-over");
  });
});

dropZone.addEventListener("drop", event => readFiles(event.dataTransfer.files));

/* Search and other controls */
$("#search-form").addEventListener("submit", runSearch);

document.querySelectorAll(".tab").forEach(tab => {
  tab.addEventListener("click", () => setMode(tab.dataset.mode));
});

$("#check-duplicates").addEventListener("click", () => renderDuplicates(true));

document.querySelectorAll(".nav-item").forEach(button => {
  button.addEventListener("click", () =>
    navigate(button.dataset.target, button.querySelector("span").textContent)
  );
});

/* Initial dashboard state */
renderFiles();
renderClusters();
renderDuplicates(false);
addActivity("Workspace ready", "Load samples or add your own text files.", "+");
