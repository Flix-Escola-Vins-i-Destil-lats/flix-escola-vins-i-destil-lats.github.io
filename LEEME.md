# Ruta Escolà

App web para el móvil (se instala como una app normal) que ordena la ruta de reparto teniendo en cuenta el tráfico y los horarios de entrega de cada cliente.

## Cómo se usa

1. **El día antes** (la ruta sale en el portal sobre las 17:30): con la APK 1.3.0, **Traer la ruta del portal** la trae con direcciones, teléfonos y horarios (y puede avisarte cuando salga). Si no, pega la lista o añade las paradas a mano. Luego, **Optimizar ruta**.
2. **10 minutos antes de salir**: pulsa **Voy a salir**. La app vuelve a calcular el orden con el tráfico del momento.
3. **Abrir en Waze** te lleva a la primera parada. Al terminar cada parada pulsa **Siguiente** (la entrega se registra en la tablet; si te equivocas, **Deshacer**): recalcula desde donde estás y te da la siguiente.

Cada cliente queda guardado con su dirección, su horario de entrega, sus notas y su teléfono. La próxima vez basta con escribir su nombre.
En su ficha se marca también cómo es **con el horario**: *Estricto* (se planifica para llegar al menos 10 min antes de que cierre) o *Flexible* (se le puede llegar hasta 30 min tarde si así sale mejor la ruta).

**Aparcar una vez para varias entregas.** Con la ruta optimizada, si varias entregas seguidas quedan a 3 manzanas o menos (4 si son tres o más), la app propone dónde dejar la furgoneta: la zona de carga y descarga más a mano para todas (datos abiertos del Ayuntamiento de Barcelona), o el punto medio si no hay ninguna. Se cuenta ida y vuelta a la furgoneta por cada pedido, y solo se propone si cabe en los 30 min que deja SPRO y nadie pasa a llegar tarde. **Aceptar** lo mete en la ruta: Waze te lleva al aparcamiento y la siguiente se hace a pie. **No, otro sitio** propone otra zona.

## Servicios de mapas (todos permiten uso de empresa)

- **Direcciones:** geocodificador oficial del ICGC y, si no encuentra la dirección, CartoCiudad (IGN). Los dos son CC BY 4.0, así que se pueden guardar y compartir entre repartidores. Antes de buscar, la app traduce "Calle Mayor, Esplugas" a "Carrer Major, Esplugues". Si el resultado cae en otra población o en otra calle, la parada queda "Sin ubicar" hasta que la confirmes.
- **Locales por su nombre:** OpenStreetMap (Nominatim), como mucho una petición por segundo.
- **Tiempos de conducción:** openrouteservice, con una clave gratuita de account.heigit.org (500 consultas al día, la app gasta unas 20). Sin clave, la app ordena las paradas por distancia aproximada.
- **Tráfico en tiempo real (opcional):** clave gratuita de TomTom (20.000 rutas al mes). Por cada cálculo, la app pide a TomTom la ruta elegida (de 1 a 3 consultas), corrige los tramos con atasco y vuelve a optimizar. Esos tiempos no se guardan, porque las condiciones de TomTom no lo permiten.

## Instalar en el móvil

Tiene que estar publicada en una dirección https, por ejemplo con Netlify Drop o GitHub Pages: se sube la carpeta `app` tal cual. Luego, desde el móvil:
- **Android (Chrome)**: menú ⋮, "Añadir a pantalla de inicio".
- **iPhone (Safari)**: botón Compartir, "Añadir a pantalla de inicio".

## Para desarrollo

- `npm test`: tests del optimizador, del lector de listas y de los aparcamientos.
- `node tools/dum-bcn.mjs <csv>`: regenera `data/dum-bcn.json` con el CSV de zonas de carga y descarga de Open Data BCN.
- `node test/real-route.mjs`: ruta de prueba con direcciones reales del Baix Llobregat.
- Al publicar cambios, sube `VERSION` en `sw.js` y en `js/app.js`: los móviles verán "Hay una versión nueva · Actualizar".
