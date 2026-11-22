# Control Datadis

App móvil (Android / iOS) para consultar tus datos eléctricos de **[Datadis](https://datadis.es)** usando su API privada gratuita para consumidores.

Hecha con **Expo SDK 58 + React Native + TypeScript + Expo Router**.

## Qué muestra

Todo lo que ofrece la API gratuita de Datadis:

| Endpoint de Datadis | En la app |
| --- | --- |
| `nikola-auth/tokens/login` | Inicio de sesión con NIF/NIE y contraseña (renovación automática del token) |
| `get-supplies-v2` | Lista de suministros (activos y de baja), dirección, CUPS, distribuidora, tipo de punto |
| `get-contract-detail-v2` | Contrato: comercializadora, potencias contratadas, tarifa de acceso, BIE, tensión, ICP, titularidad, histórico de contratos y datos de autoconsumo (CAU, tipo, coeficiente de reparto, potencia instalada) |
| `get-consumption-data-v2` | Curva de consumo **horaria o cuartohoraria**, energía vertida (excedentes), generada y autoconsumida, lecturas reales/estimadas |
| `get-max-power-v2` | Potencias máximas demandadas por mes y periodo, comparadas con la contratada |
| `get-reactive-data-v2` | Energía reactiva por mes y periodo |
| `authorizedNif` (todos) | Consulta de suministros de terceros que te han autorizado en Datadis |

## Pantallas

- **Inicio**: suministros activos y anteriores con comercializadora, potencia y tarifa de un vistazo.
- **Resumen** de cada suministro: este mes (con comparación con los mismos días del mes anterior y previsión), mes pasado (vs. mismo mes del año anterior, coste y reparto por periodos), último año mes a mes, potencia usada frente a contratada, contrato y **consejos de ahorro** automáticos.
- **Consumo**: navegación por **mes / año / últimos 12 meses** con flechas ‹ ›, datos horarios o cada 15 minutos, comparativas con el periodo anterior y:
  - Gráficas por día, por mes, por hora del día, por día de la semana, **mapa de calor** (día × hora) y la **curva de un día concreto**. Al tocar una barra se ve su valor exacto y el desglose.
  - "Ver datos" bajo cada gráfica con la tabla de valores exactos.
  - Reparto P1 punta / P2 llano / P3 valle (2.0TD) con horarios y coste por periodo.
  - Autoconsumo: generación, autoconsumo, excedentes y autosuficiencia.
  - Datos destacados (picos, días de más y menos consumo, consumo fijo en standby…).
  - **Coste estimado** desglosado con tus precios.
  - Calidad de los datos (lecturas reales/estimadas) y exportación a **CSV**.
- **Potencia**: pico de cada mes frente a la contratada, tabla por mes y periodo, todas las lecturas, recomendación de subir/bajar potencia y **energía reactiva**.
- **Contrato**: punto de suministro, contrato actual e históricos, potencias, tarifa, titularidad y autoconsumo, con explicaciones de cada concepto.

Cada bloque tiene un botón **?** con una explicación en lenguaje sencillo. Modo claro y oscuro.

## Privacidad

- Las credenciales se guardan cifradas en el dispositivo (`expo-secure-store`, Keychain/Keystore) y solo se envían a `datadis.es`.
- Las respuestas se guardan en el dispositivo **mes a mes** para no superar los límites de consultas de Datadis: solo se descarga lo que falta (mes en curso y recién cerrado: 6 h; meses cerrados: 30 días). Desliza hacia abajo para forzar la actualización.
- No hay servidor intermedio.

## Desarrollo

```bash
npm install
npx expo start        # abre con Expo Go o una development build
npm run typecheck     # tsc --noEmit
npm run lint
```

> La versión web no puede hablar con Datadis porque su API no permite CORS desde navegador; la app está pensada para Android/iOS.

### Generar la app instalable

```bash
npx eas-cli@latest build --platform android --profile preview   # APK
npx eas-cli@latest build --platform ios
```

## Estructura

```
src/
  api/datadis.ts           Cliente de la API de Datadis
  app/                     Pantallas (Expo Router): login, suministros, detalle, ajustes
  features/                Pestañas del suministro (resumen, consumo, potencia, contrato), periodos y consultas con caché mensual
  lib/                     Cálculos: periodos 2.0TD, agregados, coste, CSV, formato, almacenamiento
  context/session.tsx      Sesión, token y ajustes
  components/              UI y gráficas SVG
```

## Notas sobre la API de Datadis

- Las fechas de consulta van en formato `YYYY/MM`; la app pide rangos de hasta 12 meses por petición y, si una distribuidora falla, reintenta mes a mes.
- La hora (`time`) de cada lectura es la de **fin** del intervalo (`01:00` = consumo de 00:00 a 01:00).
- Los datos tardan 1-2 días en publicarse; los cuartohorarios y la reactiva no están disponibles para todos los contadores/distribuidoras.
- Los periodos P1/P2/P3 se calculan para la tarifa 2.0TD (≤ 15 kW).

App no oficial, sin relación con Datadis.
