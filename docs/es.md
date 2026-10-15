# Volumio

## Presentación

Esta integración lleva sus reproductores de red **Volumio** a Gladys: una Raspberry Pi con Volumio conectada a
un amplificador o a un DAC, un Volumio Primo, Rivo o Motivo. Cada reproductor se convierte en un dispositivo de
música de Gladys: reproducir, pausa, pista anterior y siguiente, volumen, estado de reproducción y «Difundir
una notificación» para la síntesis de voz y los sonidos de sus escenas. Un widget del panel muestra lo que
suena, con su portada, y las acciones de escena reproducen una lista de Volumio, una radio web favorita o
cualquier dirección de flujo.

Todo se queda en su red local: la integración habla con la API REST de Volumio y escucha las actualizaciones en
tiempo real que Volumio envía a su propia interfaz web. Sin cuenta, sin nube.

> Desarrollada sin el hardware: sus comentarios son bienvenidos. Esta integración se ha escrito a partir de la
> documentación y del código fuente de Volumio, sin un reproductor real a mano. Cuéntenos cómo le funciona en
> las [issues](https://github.com/guim31/gladys-volumio/issues).

Esta integración no está afiliada a Volumio.

## Requisitos

- Gladys Assistant **5.2.0** o posterior.
- Un reproductor Volumio (Volumio 2 o 3) en la misma red local que Gladys, accesible en su puerto 3000 (el
  predeterminado).

## Configuración

1. Instale la integración desde **Integraciones → Instalar desde GitHub**.
2. Abra la pestaña **Descubrir**: allí aparecen los reproductores encontrados. Añada los que quiera con
   **Añadir a Gladys**.
3. Si no aparece ningún reproductor, abra la pestaña **Configuración** e introduzca la dirección IP de un
   reproductor en **Direcciones de los reproductores** (en Volumio, Ajustes, Red). Los demás reproductores se
   encuentran entonces a través de él: los reproductores Volumio se conocen entre sí.

Ajustes:

| Ajuste                                    | Efecto                                                                                                                        |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Direcciones de los reproductores          | Direcciones IP o nombres de host opcionales, separados por comas. Se usa el puerto 3000 si no se indica ninguno.              |
| Actualizaciones en tiempo real            | Activado por defecto: la integración escucha los cambios que anuncia Volumio. Desactivado: consulta los reproductores.        |
| Volumen de las notificaciones (%)         | Volumen de las notificaciones que reproduce Gladys. 0 mantiene el volumen actual.                                             |
| Duración máxima de las notificaciones (s) | Una notificación más larga se detiene y la música se reanuda (60 s por defecto).                                              |
| Idioma de los nombres de las funciones    | Nombres de las funciones de los nuevos dispositivos e idioma de los mensajes de las acciones de escena (francés por defecto). |

Dos botones ayudan: **Buscar reproductores** vuelve a buscar y lista cada reproductor con su estado, y **Ver
listas y radios web favoritas** muestra los nombres exactos que debe escribir en las acciones de escena.

## Dispositivos

Cada reproductor Volumio es un dispositivo, con el nombre que tiene en Volumio, y estas funciones:

| Función                   | Tipo                       | Efecto                                                                             |
| ------------------------- | -------------------------- | ---------------------------------------------------------------------------------- |
| Volumen                   | volumen de música, 0 a 100 | Lee y ajusta el volumen del reproductor.                                           |
| Reproducir                | botón de reproducción      | Reproduce la cola.                                                                 |
| Pausa                     | botón de pausa             | Pone en pausa. Una radio web se detiene en su lugar (un flujo no se puede pausar). |
| Pista anterior            | botón anterior             | Pista anterior de la cola.                                                         |
| Pista siguiente           | botón siguiente            | Pista siguiente de la cola.                                                        |
| Estado de reproducción    | estado de reproducción     | 1 durante la reproducción, 0 en pausa o detenido. Se guarda en el historial.       |
| Difundir una notificación | difundir una notificación  | Reproduce un sonido o un mensaje hablado y después reanuda lo que sonaba.          |

Con estas funciones, el reproductor funciona con la caja **Música** del panel de Gladys y con la acción de
escena de Gladys que pronuncia un texto en un altavoz. Una notificación memoriza la cola, la pista, la
posición, el volumen y la repetición, reproduce el sonido al volumen de las notificaciones y después lo
restablece todo.

Las funciones reciben su nombre en el idioma elegido en la configuración, al añadir el dispositivo.

## Widget del panel

El widget **Volumio en reproducción** muestra el título, el artista y el álbum, la portada cuando Volumio
sirve una que Gladys acepta, el reproductor, su estado, la fuente (biblioteca musical, radio web, Spotify,
AirPlay…), el volumen, el aleatorio y la repetición. Elija el reproductor en los ajustes del widget, o déjelo
vacío para el primer reproductor añadido.

Sus botones:

- **Reproducir** / **Pausa**;
- **Siguiente**;
- **Volumen**: un pequeño formulario para escribir el volumen y silenciar o reactivar el sonido;
- **Lista**: la lista de las listas de Volumio, para iniciar una. Sin listas, o cuando Volumio no controla el
  volumen, un botón **Anterior** ocupa el lugar libre.

## Disparador de escena

**Suena una nueva pista**: un reproductor ha empezado una pista con otro título o artista, incluida una nueva
canción en una radio web que la anuncia. Puede elegir el reproductor. Variables: título, artista, álbum y
fuente, para enviar «Suena ahora» a su teléfono o mostrarlo en una pantalla. Las notificaciones que reproduce
Gladys nunca lo activan.

## Acciones de escena

| Acción                            | Efecto                                                                                                                               |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Reproducir una lista de Volumio   | Reproduce una lista guardada en Volumio, por su nombre (sin importar mayúsculas ni acentos).                                         |
| Reproducir una radio web favorita | Reproduce una radio de los favoritos de Volumio (Radios favoritas o Mis radios web), por su nombre.                                  |
| Reproducir una dirección          | Reproduce un flujo o un archivo de sonido por su dirección http(s), al volumen elegido, con la opción de reanudar después la música. |
| Ajustar aleatorio y repetir       | Activa o desactiva el aleatorio y la repetición de la cola, o los deja sin cambios.                                                  |
| Vaciar la cola                    | Vacía la cola del reproductor (la música se detiene).                                                                                |

Una radio web encontrada con la integración Radio Browser de Gladys se reproduce con **Reproducir una
dirección**.

## Ejemplos de escenas

- **Despertador**: cada día laborable a las 7:00, **Reproducir una lista de Volumio** «Mañana» en el
  dormitorio y después subir el volumen poco a poco con la función Volumen.
- **Timbre**: cuando llaman a la puerta, **Reproducir una dirección** con un sonido de campana, al 70 %,
  marcando «Después reanudar lo que sonaba»; o hacer que Gladys diga «Llaman a la puerta» en el reproductor.
- **Salir de casa**: cuando se va la última persona, controlar la función **Pausa** del reproductor, o
  **Vaciar la cola**.
- **Suena ahora en la tele**: con **Suena una nueva pista**, enviar un mensaje con el título y el artista.

## Tiempo real y consultas

Volumio no tiene cuenta ni cuota: todo pasa por la red local. La integración escucha el canal socket.io de
Volumio (el de su interfaz web) y lee el reproductor una vez cada 5 minutos por seguridad. Cuando ese canal no
está disponible, lee el reproductor cada 10 segundos durante la reproducción y cada minuto en los demás casos.
Un reproductor que no responde se vuelve a intentar al cabo de 15 segundos y después cada minuto. Solo se leen
los reproductores añadidos a Gladys. Un valor sin cambios se reenvía a Gladys cada 6 horas.

## Solución de problemas

- **Ningún reproductor en la pestaña Descubrir**: introduzca la dirección IP de un reproductor en la
  configuración y pulse **Buscar reproductores**. El descubrimiento automático (mDNS) de Gladys 5.2 puede no
  encontrar Volumio, que se anuncia con mayúsculas que el núcleo no reconoce.
- **«Salon: no responde»**: el reproductor está apagado o su dirección ha cambiado. Compruebe que
  `http://<dirección>:3000/api/v1/getState` se abre en un navegador de la misma red.
- **Una acción de escena dice que no se encuentra la lista**: pulse **Ver listas y radios web favoritas** y
  copie el nombre mostrado.
- **El widget no muestra la portada**: Gladys solo acepta portadas de 300 KB como máximo; las más grandes no
  se muestran.
- Configure `LOG_LEVEL=debug` en la integración para ver cada lectura en sus registros.

## Limitaciones

- Desarrollada sin el hardware: el canal en tiempo real (socket.io), las notificaciones y la reanudación se
  han probado con un reproductor simulado, no con un Volumio real.
- Gladys no tiene función de música para silenciar, aleatorio, repetir o el título: están en el widget y en las
  acciones de escena.
- Gladys 5.2 no transmite a las integraciones externas el volumen de su acción de escena «reproducir una
  notificación»: se aplica el volumen de las notificaciones de la configuración.
- Después de una notificación, una cola que estaba en pausa vuelve sin reproducirse, desde su primera pista.
- El sonido de la notificación lo reproduce el propio Volumio: debe poder acceder a la dirección (Gladys Plus
  para la síntesis de voz).
- La cola de un servicio de streaming (Spotify Connect, AirPlay) no se puede reanudar después de una
  notificación.
