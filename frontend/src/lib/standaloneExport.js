// Builds a single self-contained HTML file that renders a published form and
// submits responses over plain fetch(). The point: the client can drop this
// file on any static host or their own server — it doesn't need our
// #/f/<id> page or our frontend at all. It still needs SOME backend to
// receive submissions, so it posts to apiBase's /api/submissions/:id, which
// defaults to this GUUT deployment but can point at a self-hosted backend
// too (see SETUP.md's split-deploy option).

function esc(s = "") {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/** Renders a form field's answer input as an HTML string for the standalone page. */
function fieldHtml(f) {
  const req = f.required ? "required" : "";
  const label = `<label>${esc(f.label)}${f.required ? '<span class="req">*</span>' : ""}</label>`;
  let input = "";
  switch (f.type) {
    case "text":
      input = `<input type="text" name="${esc(f.id)}" placeholder="${esc(f.placeholder)}" ${req} />`;
      break;
    case "textarea":
      input = `<textarea name="${esc(f.id)}" rows="4" placeholder="${esc(f.placeholder)}" ${req}></textarea>`;
      break;
    case "number":
      input = `<input type="number" name="${esc(f.id)}" placeholder="${esc(f.placeholder)}" ${req} />`;
      break;
    case "email":
      input = `<input type="email" name="${esc(f.id)}" placeholder="${esc(f.placeholder)}" ${req} />`;
      break;
    case "date":
      input = `<input type="date" name="${esc(f.id)}" ${req} />`;
      break;
    case "checkbox":
      input = `<div class="checkbox-group">${(f.options || [])
        .map((o) => `<label class="checkbox-option"><input type="checkbox" name="${esc(f.id)}" value="${esc(o)}" /> ${esc(o)}</label>`)
        .join("")}</div>`;
      break;
    case "select":
      input = `<select name="${esc(f.id)}" ${req}><option value="">Select...</option>${(f.options || [])
        .map((o) => `<option value="${esc(o)}">${esc(o)}</option>`)
        .join("")}</select>`;
      break;
    case "rating":
      input = `<div class="rating-group" data-field="${esc(f.id)}">${[1, 2, 3, 4, 5]
        .map((n) => `<button type="button" class="rating-star" data-value="${n}">&#9733;</button>`)
        .join("")}<input type="hidden" name="${esc(f.id)}" /></div>`;
      break;
    case "file": {
      const kinds = (f.accept?.length ? f.accept : ["image", "pdf"]);
      const ext = { image: ".png,.jpg,.jpeg,.gif,.webp", pdf: ".pdf", document: ".doc,.docx", spreadsheet: ".xls,.xlsx,.csv", text: ".txt" };
      input = `<input type="file" name="${esc(f.id)}" accept="${esc(kinds.map((k) => ext[k]).filter(Boolean).join(","))}" aria-label="${esc(f.label)}" ${req} />`;
      break;
    }
    default:
      input = `<input type="text" name="${esc(f.id)}" ${req} />`;
  }
  const values = f.showIf?.values?.length ? f.showIf.values : f.showIf?.equals != null ? [f.showIf.equals] : [];
  return `<div class="field" data-show-if-field="${esc(f.showIf?.fieldId || "")}" data-show-if-op="${esc(f.showIf?.op || "eq")}" data-show-if-values="${esc(JSON.stringify(values))}">${label}${input}</div>`;
}

export function generateStandaloneHtml(form, apiBase) {
  const theme = form.theme || {};
  const primary = theme.primaryColor || "#001549";
  const bg = theme.backgroundColor || "#f6f7fb";
  const fields = [...form.fields].sort((a, b) => a.order - b.order);
  const base = (apiBase || "").replace(/\/$/, "");
  const headerImage = theme.headerImage && theme.headerImage.startsWith("/api/") ? base + theme.headerImage : theme.headerImage;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(form.title)}</title>
<style>
  * { box-sizing: border-box; }
  body { margin:0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background:${bg}; color:#1a1d29; }
  .wrap { max-width: 640px; margin: 0 auto; padding: 48px 20px; }
  form { background:#fff; border-radius:12px; padding:32px; box-shadow: 0 8px 24px rgba(16,24,40,0.1); }
  h1 { margin: 0 0 8px; font-size: 26px; }
  .desc { color:#6b7280; margin: 0 0 24px; }
  .field { margin-bottom: 18px; }
  label { display:block; font-weight:600; font-size:13px; margin-bottom:6px; }
  .req { color:#c0392b; margin-left:3px; }
  input, textarea, select { width:100%; font-size:14px; padding:9px 12px; border-radius:8px; border:1px solid #e5e7eb; font-family:inherit; }
  input[type=file] { border:none; padding:0; }
  .checkbox-group { display:flex; flex-direction:column; gap:6px; }
  .checkbox-option { display:flex; align-items:center; gap:8px; font-weight:400; }
  .checkbox-option input { width:auto; }
  .rating-group { display:flex; gap:4px; }
  .rating-star { background:none; border:none; font-size:26px; color:#d1d5db; cursor:pointer; padding:0; }
  .rating-star.filled { color:${primary}; }
  button.submit { margin-top:8px; width:100%; background:${primary}; color:#fff; border:none; border-radius:8px; padding:12px; font-size:15px; font-weight:600; cursor:pointer; }
  button.submit:disabled { opacity:0.6; cursor:not-allowed; }
  .msg { margin-top:14px; font-size:13px; }
  .msg.error { color:#c0392b; }
  .msg.ok { text-align:center; font-size:16px; padding:32px; }
  .hidden { display:none !important; }
</style>
</head>
<body>
<div class="wrap">
  <form id="f">
    ${headerImage ? `<img src="${esc(headerImage)}" alt="" style="width:100%;max-height:180px;object-fit:cover;border-radius:10px;margin-bottom:16px" />` : ""}
    <h1>${esc(form.title)}</h1>
    ${form.description ? `<p class="desc">${esc(form.description)}</p>` : ""}
    ${fields.map(fieldHtml).join("\n")}
    <button class="submit" type="submit">Submit</button>
    <div class="msg error hidden" id="err"></div>
  </form>
  <div class="msg ok hidden" id="done">Thanks, your response was recorded.</div>
</div>
<script>
(function () {
  var API_BASE = ${JSON.stringify(base)};
  var FORM_ID = ${JSON.stringify(form._id)};
  var form = document.getElementById("f");
  var err = document.getElementById("err");
  var done = document.getElementById("done");

  // Rating stars
  document.querySelectorAll(".rating-group").forEach(function (group) {
    var hidden = group.querySelector('input[type=hidden]');
    group.querySelectorAll(".rating-star").forEach(function (star) {
      star.addEventListener("click", function () {
        var val = Number(star.dataset.value);
        hidden.value = val;
        group.querySelectorAll(".rating-star").forEach(function (s) {
          s.classList.toggle("filled", Number(s.dataset.value) <= val);
        });
      });
    });
  });

  // Show/hide logic, mirroring the builder's rules (equals, is one of, at most, at least).
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
  function applyLogic() {
    var data = new FormData(form);
    document.querySelectorAll(".field[data-show-if-field]").forEach(function (el) {
      var fid = el.dataset.showIfField;
      if (!fid) { el.classList.remove("hidden"); return; }
      var srcEl = form.querySelector('[name="' + fid + '"]');
      var srcHidden = srcEl && srcEl.closest(".field") && srcEl.closest(".field").classList.contains("hidden");
      var show = !srcHidden && met(el.dataset.showIfOp || "eq", JSON.parse(el.dataset.showIfValues || "[]"), data.getAll(fid).map(String));
      el.classList.toggle("hidden", !show);
      el.querySelectorAll("input,select,textarea").forEach(function (i) { if (i.hasAttribute("required") || i.dataset.req) { i.dataset.req = "1"; i.required = show; } });
    });
  }
  form.addEventListener("input", applyLogic);
  form.addEventListener("change", applyLogic);
  applyLogic();

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    err.classList.add("hidden");
    var data = new FormData(form);
    var answers = {};
    var uploads = [];
    ${JSON.stringify(fields.map((f) => ({ id: f.id, type: f.type })))}.forEach(function (f) {
      if (f.type === "checkbox") {
        answers[f.id] = data.getAll(f.id);
      } else if (f.type === "file") {
        var file = data.get(f.id);
        answers[f.id] = "";
        if (file && file.name && file.size) uploads.push({ id: f.id, file: file });
      } else {
        answers[f.id] = data.get(f.id) || "";
      }
    });
    var btn = form.querySelector("button.submit");
    btn.disabled = true;
    btn.textContent = "Submitting...";
    // Files go up first; the response then refers to them.
    uploads.reduce(function (p, u) {
      return p.then(function () {
        return fetch(API_BASE + "/api/uploads/" + FORM_ID + "/" + encodeURIComponent(u.id), {
          method: "POST", headers: { "Content-Type": u.file.type || "application/octet-stream", "X-Filename": encodeURIComponent(u.file.name) }, body: u.file,
        }).then(function (res) { return res.json().then(function (b) { if (!res.ok) throw new Error(b.error || "Upload failed"); answers[u.id] = b; }); });
      });
    }, Promise.resolve())
      .then(function () {
        return fetch(API_BASE + "/api/submissions/" + FORM_ID, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ answers: answers }),
        });
      })
      .then(function (res) {
        if (!res.ok) return res.json().then(function (b) { throw new Error(b.error || "Submission failed"); });
        form.classList.add("hidden");
        done.classList.remove("hidden");
      })
      .catch(function (e) {
        err.textContent = e.message;
        err.classList.remove("hidden");
        btn.disabled = false;
        btn.textContent = "Submit";
      });
  });
})();
</script>
</body>
</html>
`;
}
