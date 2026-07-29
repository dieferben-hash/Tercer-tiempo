function formatearGuaranies(numero) {
  const texto = Math.round(numero).toLocaleString("es-PY").replace(/,/g, ".");
  return "₲ " + texto;
}

document.addEventListener("DOMContentLoaded", () => {
  const btnMenu = document.getElementById("btn-menu");
  const sidebar = document.getElementById("sidebar");
  const overlay = document.getElementById("overlay");

  if (btnMenu && sidebar && overlay) {
    const abrir = () => {
      sidebar.classList.add("abierto");
      overlay.classList.add("visible");
    };
    const cerrar = () => {
      sidebar.classList.remove("abierto");
      overlay.classList.remove("visible");
    };
    btnMenu.addEventListener("click", abrir);
    overlay.addEventListener("click", cerrar);
  }

  document.querySelectorAll(".flash").forEach((flash) => {
    setTimeout(() => { flash.style.display = "none"; }, 6000);
  });
});
