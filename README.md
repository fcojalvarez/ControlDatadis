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

Y a partir de esos datos calcula:

- Consumo total, media diaria, proyección a 30 días y **consumo base** (lo que está siempre encendido).
- Gráficas por **días, meses, perfil horario medio, día de la semana** y **curva de un día concreto**.
- Reparto por periodos **P1 punta / P2 llano / P3 valle** de la tarifa 2.0TD (fines de semana y festivos nacionales incluidos).
- Autoconsumo: excedentes, generación, autoconsumo y % de autosuficiencia.
- **Coste estimado** de la factura con tus propios precios (energía por periodo, potencia, compensación de excedentes, impuesto eléctrico, alquiler de contador e IVA).
- Análisis de potencia: % de uso de la potencia contratada, veces que se ha superado y recomendación de subirla o bajarla.
- Exportación de la curva de consumo a **CSV**.

## Privacidad

- Las credenciales se guardan cifradas en el dispositivo (`expo-secure-store`, Keychain/Keystore) y solo se envían a `datadis.es`.
- Las respuestas se guardan en caché en el dispositivo para no superar los límites de consultas de Datadis (mes en curso: 6 h; meses cerrados: 7 días). Desliza hacia abajo para forzar la actualización.
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
  features/                Pestañas del suministro (consumo, potencia, contrato, reactiva) y consultas
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
