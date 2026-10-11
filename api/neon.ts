// Declaración de la función `api` para el CLI de Neon.
//   neon dev      -> sirve las funciones en local con recarga automática
//   neon deploy   -> publica en https://<rama>-api.compute.<region>.neon.tech
//
// DATABASE_URL / DATABASE_URL_UNPOOLED los inyecta Neon sola desde la rama
// vinculada; por eso no figuran acá.
import { defineConfig } from "@neon/config/v1";

export default defineConfig({
  functions: {
    api: {
      name: "Cotizador Cubica3D",
      source: "./functions/api.js",
      env: {
        // Dominio(s) del frontend autorizados a llamar la API, separados por coma.
        // Ej.: "https://cotizador.cubica3d.com,http://localhost:5173"
        // Vacío = se refleja cualquier origen (cómodo para probar, no para producción).
        APP_ORIGEN: process.env.APP_ORIGEN ?? "",
      },
    },
  },
});
