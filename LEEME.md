# Ruta Escolà

App web para el móvil (se instala como una app normal) que ordena la ruta de reparto teniendo en cuenta el tráfico y los horarios de entrega de cada cliente.

## Cómo se usa

1. **El día antes**: pega la lista del portal (o añade las paradas a mano) y pulsa **Optimizar ruta**.
2. **10 minutos antes de salir**: pulsa **Voy a salir**. La app vuelve a calcular el orden con el tráfico del momento.
3. **Abrir en Waze** te lleva a la primera parada. Al terminar cada entrega pulsa **Entregado · siguiente**: recalcula desde donde estás y te da la siguiente.

Cada cliente queda guardado con su dirección, su horario de entrega, sus notas y su teléfono. La próxima vez basta con escribir su nombre.

## Tráfico real

Sin clave, la app usa OpenStreetMap con un factor de tráfico según la hora del día: funciona, pero no ve accidentes. Para tener tráfico real hay que crear una clave gratuita en developer.tomtom.com, sin tarjeta, con 2.500 consultas al día, y pegarla en **Ajustes**.

Cada repartidor debería usar su propia clave. Gasto aproximado por día con 15 paradas:
- unas 180 consultas al planificar;
- otras 180 al pulsar "Voy a salir";
- unas 15 cada vez que pulsas "Siguiente".

## Instalar en el móvil

Tiene que estar publicada en una dirección https, por ejemplo con Netlify Drop o GitHub Pages: se sube la carpeta `app` tal cual. Luego, desde el móvil:
- **Android (Chrome)**: menú ⋮, "Añadir a pantalla de inicio".
- **iPhone (Safari)**: botón Compartir, "Añadir a pantalla de inicio".

## Para desarrollo

- `npm test`: tests del optimizador y del lector de listas.
- `node test/real-route.mjs`: ruta de prueba con direcciones reales del Baix Llobregat.
