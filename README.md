# VoucherApp - Generador de Vouchers Hotspot

App Android para generar vouchers WiFi en MikroTik sin depender de Termux ni servidores externos.

## ¿Qué hace?

- Se conecta directo al MikroTik vía API (TCP puerto 8728)
- Lee los planes/perfiles configurados
- Genera usuarios hotspot aleatorios (username 5 letras, password 5 dígitos)
- Los crea en el MikroTik
- Genera un PDF listo para imprimir en impresora térmica 58mm
- Comparte el PDF por WhatsApp, Telegram, etc.

## Cómo usarla

1. Instalás el APK en tu Android
2. Abrí la app
3. Agregá tu MikroTik (IP, contraseña, nombre del hotspot)
4. Seleccioná el plan (1HORA, 1DIA, etc.)
5. Indicá cuántos vouchers querés
6. ¡Listo! Descargás o compartís el PDF

## Cómo compilar (si querés hacerlo vos mismo)

### Opción 1: GitHub Actions (recomendada)
1. Creá un repo en GitHub
2. Subí estos archivos
3. Entrá a Actions → Build APK → Run workflow
4. Descargás el APK de los artifacts

### Opción 2: Local (necesitás Android Studio)
```bash
npm install
npx cap sync android
npx cap open android  # Abrí en Android Studio y compilá
```

## Requisitos del MikroTik

- RouterOS v6 o v7
- API service habilitado (puerto 8728)
  - `/ip/service set api disabled=no`
- Perfiles hotspot configurados con OnLogin (estilo Mikhmon)

## Seguridad

- Las contraseñas de los MikroTiks se guardan SOLO en el almacenamiento local del teléfono (localStorage)
- No hay servidores externos, no hay base de datos en la nube
- La app solo funciona en la misma red que el MikroTik
