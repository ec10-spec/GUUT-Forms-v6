// Builds a single self-contained HTML file for a published form. Anyone can
// download it (individual, business or platform team) and share it however
// they like: email attachment, Google Drive, a static host, their own site.
//
// How it works:
// - The form definition is embedded, so the page renders even offline.
// - On load it asks the API for the live form. If the owner has edited the
//   form since the download, the page re-renders with the current questions,
//   and if the form was unpublished or deleted it says so. This keeps a file
//   that was shared weeks ago in step with the form.
// - Submissions and file uploads go to apiBase (this GUUT deployment by
//   default, so they land in GUUT's hosted database or the company's own
//   database, exactly like the #/f/<id> link). Business accounts and the
//   platform team may point apiBase at their own backend (see SETUP.md).
// The public submit, upload and form endpoints accept requests from any
// origin, including a file opened straight from disk (backend/server.js).

function esc(s = "") {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// JSON that is safe inside a <script> tag.
function scriptJson(v) {
  return JSON.stringify(v).replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
}

// Only what a respondent needs: no owner, prompts or internal fields.
function snapshot(form) {
  return {
    _id: String(form._id),
    title: form.title || "",
    description: form.description || "",
    theme: { primaryColor: form.theme?.primaryColor || "", backgroundColor: form.theme?.backgroundColor || "", headerImage: form.theme?.headerImage || "" },
    fields: [...(form.fields || [])].sort((a, b) => (a.order ?? 0) - (b.order ?? 0)).map((f) => ({
      id: f.id, type: f.type, label: f.label || "", placeholder: f.placeholder || "", required: !!f.required,
      options: f.options || [], accept: f.accept || [], showIf: f.showIf || null,
    })),
    hideBranding: !!form.hideBranding,
  };
}

export function standaloneFileName(form) {
  return `${(form?.title || "form").replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase() || "form"}.html`;
}

export function generateStandaloneHtml(form, apiBase, { appUrl = "" } = {}) {
  const snap = snapshot(form);
  const base = (apiBase || "").replace(/\/$/, "");
  const home = (appUrl || base).replace(/\/$/, "");
  const primary = snap.theme.primaryColor || "#001549";
  const bg = snap.theme.backgroundColor || "#f6f7fb";

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(snap.title)}</title>
<style>
  * { box-sizing: border-box; }
  :root { --primary: ${esc(primary)}; --bg: ${esc(bg)}; }
  body { margin:0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background:var(--bg); color:#1a1d29; }
  .wrap { max-width: 640px; margin: 0 auto; padding: 48px 16px; }
  .card { background:#fff; border-radius:12px; padding:32px; box-shadow: 0 8px 24px rgba(16,24,40,0.1); }
  @media (max-width: 520px) { .wrap { padding: 20px 12px; } .card { padding: 22px 18px; } }
  .header-img { width:100%; max-height:180px; object-fit:cover; border-radius:10px; margin-bottom:16px; display:block; }
  h1 { margin: 0 0 8px; font-size: 26px; }
  .desc { color:#6b7280; margin: 0 0 24px; white-space: pre-wrap; }
  .field { margin-bottom: 18px; }
  .field > label { display:block; font-weight:600; font-size:13px; margin-bottom:6px; }
  .req { color:#c0392b; margin-left:3px; }
  input, textarea, select { width:100%; font-size:14px; padding:9px 12px; border-radius:8px; border:1px solid #e5e7eb; font-family:inherit; background:#fff; color:inherit; }
  input[type=file] { border:none; padding:0; }
  .checkbox-group { display:flex; flex-direction:column; gap:6px; }
  .checkbox-option { display:flex; align-items:center; gap:8px; font-weight:400; font-size:14px; }
  .checkbox-option input { width:auto; }
  .rating-group { display:flex; gap:4px; }
  .rating-star { background:none; border:none; font-size:26px; color:#d1d5db; cursor:pointer; padding:0; }
  .rating-star.filled { color:var(--primary); }
  .field-error { color:#c0392b; font-size:12px; margin-top:4px; display:block; }
  button.submit, button.again { margin-top:8px; width:100%; background:var(--primary); color:#fff; border:none; border-radius:8px; padding:12px; font-size:15px; font-weight:600; cursor:pointer; }
  button.again { width:auto; padding:10px 18px; background:#fff; color:#1a1d29; border:1px solid #e5e7eb; }
  button:disabled { opacity:0.6; cursor:not-allowed; }
  .msg { margin-top:14px; font-size:13px; }
  .msg.error { color:#c0392b; }
  .center { text-align:center; }
  .done-msg { font-size:16px; color:var(--primary); margin: 8px 0 18px; }
  .brand { display:block; text-align:center; margin-top:18px; font-size:12px; color:#6b7280; text-decoration:none; }
  .brand:hover { text-decoration:underline; }
  .hidden { display:none !important; }
</style>
</head>
<body>
<div class="wrap">
  <div class="card" id="app"><h1>${esc(snap.title)}</h1><p class="desc">Loading form...</p></div>
  <a class="brand hidden" id="brand" href="${esc(home)}" target="_blank" rel="noopener">Made with GUUT Forms</a>
</div>
<script>
(function () {
  var API_BASE = ${scriptJson(base)};
  var SNAPSHOT = ${scriptJson(snap)};
  var form = SNAPSHOT;
  var touched = false;
  var app = document.getElementById("app");
  var brand = document.getElementById("brand");
  var EXT = { image: ".png,.jpg,.jpeg,.gif,.webp", pdf: ".pdf", document: ".doc,.docx", spreadsheet: ".xls,.xlsx,.csv", text: ".txt" };

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; });
  }
  function abs(u) { return u && u.indexOf("/api/") === 0 ? API_BASE + u : u; }

  function fieldHtml(f) {
    var req = f.required ? " required" : "";
    var name = ' name="' + esc(f.id) + '" id="q_' + esc(f.id) + '"';
    var ph = ' placeholder="' + esc(f.placeholder) + '"';
    var input;
    switch (f.type) {
      case "textarea": input = "<textarea" + name + ' rows="4"' + ph + req + "></textarea>"; break;
      case "number": input = '<input type="number" inputmode="decimal"' + name + ph + req + " />"; break;
      case "email": input = '<input type="email" autocomplete="email"' + name + ph + req + " />"; break;
      case "date": input = '<input type="date"' + name + req + " />"; break;
      case "checkbox":
        input = '<div class="checkbox-group">' + (f.options || []).map(function (o) {
          return '<label class="checkbox-option"><input type="checkbox" name="' + esc(f.id) + '" value="' + esc(o) + '" /> ' + esc(o) + "</label>";
        }).join("") + "</div>";
        break;
      case "select":
        input = "<select" + name + req + '><option value="">Select...</option>' + (f.options || []).map(function (o) {
          return '<option value="' + esc(o) + '">' + esc(o) + "</option>";
        }).join("") + "</select>";
        break;
      case "rating":
        input = '<div class="rating-group">' + [1, 2, 3, 4, 5].map(function (n) {
          return '<button type="button" class="rating-star" data-value="' + n + '" aria-label="' + n + ' of 5">&#9733;</button>';
        }).join("") + '<input type="hidden" name="' + esc(f.id) + '" /></div>';
        break;
      case "file":
        var kinds = f.accept && f.accept.length ? f.accept : ["image", "pdf"];
        input = '<input type="file"' + name + ' accept="' + esc(kinds.map(function (k) { return EXT[k]; }).filter(Boolean).join(",")) + '"' + req + " />";
        break;
      default: input = '<input type="text"' + name + ph + req + " />";
    }
    var s = f.showIf || {};
    var values = s.values && s.values.length ? s.values : s.equals != null ? [s.equals] : [];
    return '<div class="field" data-field="' + esc(f.id) + '" data-show-if-field="' + esc(s.fieldId || "") + '" data-show-if-op="' + esc(s.op || "eq") +
      '" data-show-if-values="' + esc(JSON.stringify(values)) + '"><label for="q_' + esc(f.id) + '">' + esc(f.label) +
      (f.required ? '<span class="req">*</span>' : "") + "</label>" + input + "</div>";
  }

  function headerHtml() {
    var img = abs(form.theme && form.theme.headerImage);
    return (img ? '<img class="header-img" src="' + esc(img) + '" alt="" />' : "") + "<h1>" + esc(form.title) + "</h1>" +
      (form.description ? '<p class="desc">' + esc(form.description) + "</p>" : "");
  }

  function setTheme() {
    var t = form.theme || {};
    if (t.primaryColor) document.documentElement.style.setProperty("--primary", t.primaryColor);
    if (t.backgroundColor) document.documentElement.style.setProperty("--bg", t.backgroundColor);
    document.title = form.title || "Form";
    brand.classList.toggle("hidden", !!form.hideBranding);
  }

  function showMessage(title, text) {
    app.innerHTML = "<h1>" + esc(title) + '</h1><p class="desc">' + esc(text) + "</p>";
  }

  function met(op, values, answers) {
    answers = answers.filter(function (a) { return a !== ""; });
    if (!answers.length || !values.length) return false;
    if (op === "lte" || op === "gte") {
      var a = answers[0], b = values[0];
      var na = Number(a), nb = Number(b);
      var d = !isNaN(na) && !isNaN(nb) && a !== "" ? na - nb : a < b ? -1 : a > b ? 1 : 0;
      return op === "lte" ? d <= 0 : d >= 0;
    }
    if (op === "in") return answers.some(function (x) { return values.indexOf(x) !== -1; });
    return answers.indexOf(values[0]) !== -1 || (Number(answers[0]) === Number(values[0]) && answers[0] !== "");
  }

  function render() {
    setTheme();
    var sorted = form.fields.slice();
    app.innerHTML = '<form id="f" novalidate>' + headerHtml() + sorted.map(fieldHtml).join("") +
      '<button class="submit" type="submit">Submit</button><div class="msg error hidden" id="err" role="alert"></div></form>';
    var el = document.getElementById("f");
    var err = document.getElementById("err");

    el.querySelectorAll(".rating-group").forEach(function (group) {
      var hidden = group.querySelector("input[type=hidden]");
      group.querySelectorAll(".rating-star").forEach(function (star) {
        star.addEventListener("click", function () {
          var val = Number(star.dataset.value);
          hidden.value = val;
          touched = true;
          group.parentNode.querySelectorAll(".field-error").forEach(function (x) { x.remove(); });
          group.querySelectorAll(".rating-star").forEach(function (s) { s.classList.toggle("filled", Number(s.dataset.value) <= val); });
          applyLogic();
        });
      });
    });

    function applyLogic() {
      var data = new FormData(el);
      el.querySelectorAll(".field").forEach(function (box) {
        var fid = box.dataset.showIfField;
        var show = true;
        if (fid) {
          var src = el.querySelector('.field[data-field="' + fid.replace(/"/g, "") + '"]');
          show = !(src && src.classList.contains("hidden")) &&
            met(box.dataset.showIfOp || "eq", JSON.parse(box.dataset.showIfValues || "[]"), data.getAll(fid).map(String));
        }
        box.classList.toggle("hidden", !show);
        box.querySelectorAll("input,select,textarea").forEach(function (i) {
          if (i.hasAttribute("required") || i.dataset.req) { i.dataset.req = "1"; i.required = show; }
        });
      });
    }
    function onEdit(e) {
      touched = true;
      var box = e.target.closest && e.target.closest(".field");
      if (box) box.querySelectorAll(".field-error").forEach(function (x) { x.remove(); });
      if (!el.querySelector(".field-error")) err.classList.add("hidden");
      applyLogic();
    }
    el.addEventListener("input", onEdit);
    el.addEventListener("change", onEdit);
    applyLogic();

    function clearErrors() {
      err.classList.add("hidden");
      el.querySelectorAll(".field-error").forEach(function (x) { x.remove(); });
    }
    function fieldError(id, message) {
      var box = el.querySelector('.field[data-field="' + String(id).replace(/"/g, "") + '"]');
      if (!box) return;
      var s = document.createElement("span");
      s.className = "field-error";
      s.textContent = message;
      box.appendChild(s);
    }

    el.addEventListener("submit", function (e) {
      e.preventDefault();
      clearErrors();
      var data = new FormData(el);
      var answers = {};
      var uploads = [];
      var missing = false;
      form.fields.forEach(function (f) {
        var box = el.querySelector('.field[data-field="' + String(f.id).replace(/"/g, "") + '"]');
        var visible = box && !box.classList.contains("hidden");
        if (f.type === "checkbox") answers[f.id] = visible ? data.getAll(f.id) : [];
        else if (f.type === "file") {
          var file = data.get(f.id);
          answers[f.id] = "";
          if (visible && file && file.name && file.size) uploads.push({ id: f.id, file: file });
        } else answers[f.id] = visible ? data.get(f.id) || "" : "";
        var empty = f.type === "checkbox" ? !answers[f.id].length : f.type === "file" ? !uploads.some(function (u) { return u.id === f.id; }) : !String(answers[f.id]).trim();
        if (visible && f.required && empty) { missing = true; fieldError(f.id, "This question is required."); }
      });
      if (missing) { err.textContent = "Please answer the required questions."; err.classList.remove("hidden"); return; }
      var btn = el.querySelector("button.submit");
      btn.disabled = true;
      btn.textContent = "Submitting...";
      uploads.reduce(function (p, u) {
        return p.then(function () {
          return fetch(API_BASE + "/api/uploads/" + form._id + "/" + encodeURIComponent(u.id), {
            method: "POST", headers: { "Content-Type": u.file.type || "application/octet-stream", "X-Filename": encodeURIComponent(u.file.name) }, body: u.file,
          }).then(function (res) { return res.json().then(function (b) { if (!res.ok) throw b; answers[u.id] = b; }); });
        });
      }, Promise.resolve())
        .then(function () {
          return fetch(API_BASE + "/api/submissions/" + form._id, {
            method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ answers: answers }),
          });
        })
        .then(function (res) {
          if (!res.ok) return res.json().then(function (b) { throw b; });
          showDone();
        })
        .catch(function (e) {
          if (e && e.fields) e.fields.forEach(function (x) { fieldError(x.fieldId, x.message); });
          err.textContent = (e && (e.error || e.message)) || "Could not reach the server. Check your connection and try again.";
          if (e instanceof TypeError) err.textContent = "Could not reach the server. Check your connection and try again.";
          err.classList.remove("hidden");
          btn.disabled = false;
          btn.textContent = "Submit";
        });
    });
  }

  function showDone() {
    app.innerHTML = '<div class="center">' + headerHtml() + '<p class="done-msg">Thanks, your response was recorded.</p>' +
      '<button type="button" class="again" id="again">Submit another response</button></div>';
    document.getElementById("again").addEventListener("click", function () { touched = false; render(); });
  }

  function same(a, b) {
    return JSON.stringify([a.title, a.description, a.theme, a.fields]) === JSON.stringify([b.title, b.description, b.theme, b.fields]);
  }

  function normalise(live) {
    return {
      _id: String(live._id || form._id),
      title: live.title || "",
      description: live.description || "",
      theme: { primaryColor: (live.theme && live.theme.primaryColor) || "", backgroundColor: (live.theme && live.theme.backgroundColor) || "", headerImage: (live.theme && live.theme.headerImage) || "" },
      fields: (live.fields || []).slice().sort(function (a, b) { return (a.order || 0) - (b.order || 0); }).map(function (f) {
        return { id: f.id, type: f.type, label: f.label || "", placeholder: f.placeholder || "", required: !!f.required, options: f.options || [], accept: f.accept || [], showIf: f.showIf || null };
      }),
      hideBranding: !!live.hideBranding,
    };
  }

  render();

  // Keep the shared file in step with the live form.
  fetch(API_BASE + "/api/forms/" + SNAPSHOT._id, { headers: { Accept: "application/json" } })
    .then(function (res) {
      if (res.status === 404) { showMessage(SNAPSHOT.title || "Form", "This form isn't accepting responses right now. It may have been unpublished or deleted."); return null; }
      return res.ok ? res.json() : null;
    })
    .then(function (live) {
      if (!live) return;
      if (!live.publishedAt) { showMessage(live.title || "Form", "This form isn't accepting responses right now."); return; }
      var next = normalise(live);
      var changed = !same(next, form);
      form = next;
      if (changed && !touched) render();
      else setTheme();
    })
    .catch(function () { /* offline or blocked: keep the embedded copy */ });
})();
</script>
</body>
</html>
`;
}
