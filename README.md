<!doctype html>
<html lang="es">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Buscador Académico</title>
    <script src="https://cdn.tailwindcss.com"></script>
  </head>
  <body class="bg-gray-50 p-6">
    <div class="max-w-5xl mx-auto">
      <h1 class="text-2xl font-bold mb-4">Buscador Académico (Redalyc + SciELO)</h1>
      <form id="buscador" class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
        <input id="q" type="text" placeholder="Palabra clave..." class="border rounded p-2" />
        <input id="desde" type="date" class="border rounded p-2" />
        <input id="hasta" type="date" class="border rounded p-2" />
        <label class="flex items-center space-x-2">
          <input id="redalyc" type="checkbox" checked />
          <span>Redalyc</span>
        </label>
        <label class="flex items-center space-x-2">
          <input id="scielo" type="checkbox" checked />
          <span>SciELO</span>
        </label>
        <button type="submit" id="btnBuscar" class="bg-blue-600 text-white rounded p-2 hover:bg-blue-700">
          Buscar
        </button>
      </form>
      <p class="mb-4">Total: <span id="total">0</span></p>
      <div class="overflow-x-auto">
        <table class="min-w-full border">
          <thead>
            <tr class="bg-gray-200">
              <th class="p-2 border">Título</th>
              <th class="p-2 border">Autores</th>
              <th class="p-2 border">Fecha</th>
              <th class="p-2 border">Fuente</th>
              <th class="p-2 border">Enlace</th>
            </tr>
          </thead>
          <tbody id="resultados"></tbody>
        </table>
      </div>
    </div>

    <script>
      const form = document.getElementById("buscador");
      const resultados = document.getElementById("resultados");
      const totalEl = document.getElementById("total");
      const btnBuscar = document.getElementById("btnBuscar");

      form.addEventListener("submit", async (e) => {
        e.preventDefault();
        btnBuscar.textContent = "Buscando...";
        btnBuscar.disabled = true;
        resultados.innerHTML = "";
        totalEl.textContent = "0";

        const params = new URLSearchParams({
          q: document.getElementById("q").value,
          desde: document.getElementById("desde").value,
          hasta: document.getElementById("hasta").value,
          redalyc: document.getElementById("redalyc").checked,
          scielo: document.getElementById("scielo").checked,
        });

        try {
          const res = await fetch("http://127.0.0.1:8000/buscar?" + params.toString());
          const data = await res.json();
          totalEl.textContent = data.total || 0;
          (data.items || []).forEach((item) => {
            const tr = document.createElement("tr");
            tr.classList.add("hover:bg-gray-100");
            tr.innerHTML = `
              <td class="p-2 border">${item.title || ""}</td>
              <td class="p-2 border">${(item.authors || []).join(", ")}</td>
              <td class="p-2 border">${item.date || ""}</td>
              <td class="p-2 border">${item.source || ""}</td>
              <td class="p-2 border"><a href="${item.url || "#"}" target="_blank" class="text-blue-600 hover:underline">Abrir</a></td>
            `;
            resultados.appendChild(tr);
          });
        } catch (err) {
          alert("Error consultando el backend: " + err);
        }
        btnBuscar.textContent = "Buscar";
        btnBuscar.disabled = false;
      });
    </script>
  </body>
</html>
