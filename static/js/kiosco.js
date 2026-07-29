document.addEventListener("DOMContentLoaded", () => {
  const totalSpan = document.getElementById("total-venta");

  function actualizarTotalVenta() {
    let total = 0;
    document.querySelectorAll(".stepper-input").forEach((input) => {
      const precio = parseFloat(input.dataset.precio || "0");
      const cantidad = parseInt(input.value || "0", 10);
      total += precio * cantidad;
    });
    if (totalSpan) totalSpan.textContent = formatearGuaranies(total);
  }

  document.querySelectorAll(".stepper-btn").forEach((boton) => {
    boton.addEventListener("click", () => {
      const input = boton.parentElement.querySelector(".stepper-input");
      const stock = parseInt(input.dataset.stock || "0", 10);
      let valor = parseInt(input.value || "0", 10);
      if (boton.dataset.accion === "sumar") {
        valor = Math.min(valor + 1, stock);
      } else {
        valor = Math.max(valor - 1, 0);
      }
      input.value = valor;
      actualizarTotalVenta();
    });
  });

  actualizarTotalVenta();
});
