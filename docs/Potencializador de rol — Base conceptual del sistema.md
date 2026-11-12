# Potencializador de rol — Base conceptual del sistema

Nov 12, 2026 · @Leonardo Agudelo

## 1. Propósito y principios

El Potencializador de rol es un sistema para diagnosticar y desarrollar las capacidades de las personas que ejercen un rol, medidas contra lo que su organización realmente necesita de ese rol y no contra un estándar teórico. Cada organización define, por rol, un mapa de capacidades observables; cada persona acuerda una línea base sobre ese mapa y la mueve con evidencia a lo largo de ciclos de mejora.

Principios de diseño que el sistema debe proteger:

1. **Contextual.** El mapa de capacidades lo define cada organización para cada rol. El sistema no trae un estándar único.
2. **Evidencia sobre percepción.** La autoevaluación es solo el punto de partida; el nivel se acuerda y se cambia con hechos observables.
3. **Progreso frente a uno mismo.** No hay rankings ni comparaciones entre personas. Cada quien enfrenta contextos distintos.
4. **Foco.** En cada ciclo se trabajan pocas capacidades, y cada una se convierte en un experimento sobre el trabajo real.
5. **Capacidad instalada.** La organización debe poder operar el sistema sin acompañamiento externo.
6. **Configuración como datos.** Dimensiones, niveles, multiplicadores, dificultad y bonificaciones se configuran; no se programan.

No es una evaluación de desempeño, ni una plataforma de cursos, ni una herramienta para comparar personas.

## 2. Del caso puntual al modelo genérico

Todo lo que en el caso de origen (Product Owners de una universidad) es un nombre propio pasa a ser un dato configurable. La tabla muestra la correspondencia.

| En el caso de origen | Concepto genérico | Qué queda configurable |
| --- | --- | --- |
| Universidad de los Andes | Organización | Nombre, contexto estratégico, roles |
| Product Owner | Rol | Cualquier rol de cualquier organización |
| El potencializador de POs | Mapa de capacidades de un rol | Contenido completo, con versiones |
| Entender, Descubrir, Priorizar, Crear, Adaptar / Impactar | Dimensiones de ciclo de trabajo | Las etapas del flujo de trabajo propio del rol |
| Comunicación, Autonomía, Liderazgo, Complejidad de problemas | Dimensiones transversales | Nombre, cantidad y orden |
| Niveles 0 a 4 (no sabe, principiante, en práctica, experiencia, transferencia) | Escala de madurez | Cantidad de niveles, nombres, descripción y multiplicador |
| Tarjeta | Capacidad observable | Enunciado, dimensión, dificultad |
| OKRs, Jobs to be Done | Herramientas y técnicas asociadas | Catálogo por organización |
| PDI, ecosistema federado | Objetivos estratégicos de la organización | Lista propia; se vinculan a capacidades |
| Estrellitas | Dificultad de la capacidad | Niveles de dificultad; es informativa, no pondera el puntaje |
| Plus por IA con transferencia | Regla de bonificación | Nombre, puntos extra y condición exigida |
| PO evaluado | Participante | — |
| Líder, especialista interno, mentor externo (la tríada) | Panel de calibración | Qué roles lo integran y cuáles son obligatorios |
| Programa de mentorías | Programa | Fechas, participantes, mapa usado |
| Revisión trimestral o semestral | Ciclo | Duración y cantidad de focos |
| Autodiagnóstico | Autoevaluación | — |
| Línea base definitiva | Línea base | — |
| Experimento práctico | Experimento | — |
| Mover la tarjeta a la derecha | Cambio de nivel con evidencia | Quién lo aprueba |

## 3. Glosario (lenguaje ubicuo)

Estos términos deben usarse igual en conversaciones, interfaz y código. El identificador en inglés es una sugerencia para el código.

| Término | Identificador | Definición |
| --- | --- | --- |
| Organización | `Organization` | Entidad dueña de sus roles, mapas, programas y personas. |
| Firma de mentores | MentoringFirm | Quien opera la plataforma y acompaña a las organizaciones cliente (Kleer). Es dueña de los mapas plantilla. |
| Mapa plantilla | MapTemplate | Mapa reutilizable de la firma de mentores. Una organización parte de una copia; la plantilla nunca es de la organización cliente. |
| Rol | `Role` | Función profesional cuyas capacidades se quieren desarrollar. |
| Mapa de capacidades | `CapabilityMap` | Conjunto versionado de dimensiones y capacidades que una organización espera de un rol. De él se eligen las capacidades de cada participante. |
| Dimensión | `Dimension` | Agrupador de capacidades. Es de ciclo de trabajo o transversal. |
| Capacidad observable | `Capability` | Comportamiento concreto que se puede verificar con hechos. Es la tarjeta del tablero. |
| Herramienta | `Tool` | Técnica o conocimiento recomendado que habilita una capacidad. |
| Escala de madurez | `MaturityScale` | Lista ordenada de niveles con su multiplicador. |
| Nivel | `Level` | Grado de dominio de una capacidad. Es la columna del tablero. |
| Programa | `Program` | Proceso acotado en el tiempo en el que un grupo de participantes trabaja sobre una versión del mapa. |
| Participante | `Participant` | Persona que ejerce el rol y desarrolla sus capacidades. |
| Panel de calibración | `CalibrationPanel` | Personas que contrastan la autoevaluación con hechos. |
| Tablero | `Board` | Vista tipo Kanban de un participante: capacidades en filas por dimensión y columnas por nivel. |
| Ubicación | `Placement` | Nivel actual de una capacidad en un tablero. |
| Autoevaluación | `SelfAssessment` | Ubicación propuesta por el participante según su percepción. |
| Calibración | `CalibrationSession` | Sesión en la que el panel y el participante acuerdan niveles con casos reales. |
| Línea base | `Baseline` | Fotografía acordada del tablero al terminar la calibración. Sus entradas no se editan; solo se le agregan las capacidades que ingresan después, con su nivel inicial. |
| Bonificación otorgada | `BonusAward` | Aplicación de una regla de bonificación a una ubicación, con evidencia y aprobación. |
| Membresía | `OrganizationMembership` | Papel de una persona en una organización, independiente de los programas: administrador o diseñador del mapa. |
| Superadministrador | `SuperAdmin` | Persona de la firma de mentores. Crea las cuentas de las organizaciones cliente y puede administrar dentro de ellas por soporte. |
| Ciclo | `Cycle` | Periodo de mejora con focos, experimentos y cierre. |
| Foco | `Focus` | Capacidad priorizada para un ciclo. |
| Experimento | `Experiment` | Acción concreta en el trabajo real para desarrollar un foco. |
| Evidencia | `Evidence` | Hecho observable registrado que sustenta un nivel o un cambio de nivel. |
| Cambio de nivel | `LevelChange` | Registro de que una capacidad pasó de un nivel a otro, con motivo y aprobación. |
| Fotografía | `Snapshot` | Copia del tablero y su puntaje en una fecha. |
| Puntaje de madurez | `MaturityScore` | Número calculado a partir de las ubicaciones del tablero. |

## 4. Modelo de dominio

El modelo tiene tres zonas: la **definición** (qué se espera del rol), la **operación** (qué hace cada participante) y la **historia** (qué cambió y por qué). Separarlas permite cambiar el mapa sin dañar los registros de las personas.

### 4.1 Definición

| Entidad | Atributos principales | Relaciones |
| --- | --- | --- |
| MentoringFirm | nombre | atiende a varias organizaciones; es dueña de los mapas plantilla; tiene mentores |
| MapTemplate | nombre, rol de referencia, mismo contenido que un mapa | pertenece a la firma de mentores; se copia para crear el mapa de una organización |
| `Organization` | nombre | tiene roles, objetivos estratégicos, herramientas, personas |
| `StrategicObjective` | nombre, descripción | pertenece a una organización; se vincula a capacidades |
| `Role` | nombre, descripción | pertenece a una organización; tiene mapas |
| `CapabilityMap` | versión, estado (borrador, publicado, archivado) | pertenece a un rol; tiene una escala, dimensiones y reglas de bonificación |
| `MaturityScale` | — | pertenece a un mapa; tiene niveles ordenados |
| `Level` | orden, nombre, descripción, multiplicador, exige transferencia (sí/no) | pertenece a una escala |
| `Dimension` | nombre, descripción, tipo (ciclo de trabajo, transversal), orden | pertenece a un mapa; tiene capacidades |
| `Capability` | enunciado observable, dificultad (baja, media, alta), activa (derivado: está siendo usada en al menos un programa) | pertenece a una dimensión; usa herramientas; apunta a objetivos estratégicos |
| `Tool` | nombre, descripción, enlace | pertenece a una organización; se asocia a capacidades |
| `BonusRule` | nombre, puntos extra, condición exigida (texto) | pertenece a un mapa; se aplica mediante bonificaciones otorgadas |

### 4.2 Operación

| Entidad | Atributos principales | Relaciones |
| --- | --- | --- |
| `Person` | nombre, correo | pertenece a una organización o a la firma de mentores; las personas de la firma son superadministradoras |
| `OrganizationMembership` | papel en la organización (administrador, diseñador del mapa) | une una persona con una organización; no depende de ningún programa |
| `Program` | nombre, fechas, máximo de focos por ciclo, roles obligatorios del panel | usa una versión publicada del mapa de un rol; tiene la selección base de capacidades para todos sus participantes |
| `Enrollment` | papel en el programa (participante, líder, especialista, mentor, administrador) | une una persona con un programa |
| `PanelAssignment` | — | asigna líder, especialista y mentor a un participante |
| `Board` | estado | uno por participante y programa; una persona con varios roles tiene un tablero por cada uno; tiene ubicaciones y ciclos |
| `Placement` | nivel actual (vacío si está sin ubicar), fecha de ingreso al tablero, quién la agregó, nivel de línea base y su fecha | une un tablero con una capacidad seleccionada para ese participante; tiene bonificaciones otorgadas |
| `BonusAward` | estado (propuesta, aprobada, rechazada), fecha, propuesta por, aprobada por | une una ubicación con una regla de bonificación; cita evidencias; a lo sumo una por regla y ubicación |
| `SelfAssessment` | fecha, niveles propuestos por capacidad | pertenece a un tablero |
| `CalibrationSession` | fecha, asistentes, notas, niveles acordados | pertenece a un tablero; produce una línea base |
| `Cycle` | número, fechas, estado | pertenece a un tablero; tiene focos |
| `Focus` | nivel objetivo | une un ciclo con una capacidad; tiene experimentos |
| `Experiment` | descripción, resultado esperado, estado, aprendizajes | pertenece a un foco |
| `MentoringSession` | fecha, notas | pertenece a un tablero; revisa experimentos |
| `Evidence` | descripción del hecho, enlace opcional, fecha, autor | sustenta un experimento, un cambio de nivel o una bonificación otorgada |

### 4.3 Historia

| Entidad | Atributos principales | Relaciones |
| --- | --- | --- |
| `LevelChange` | nivel anterior (vacío si estaba sin ubicar), nivel nuevo, fecha, motivo (calibración, nivelación inicial, evidencia), aprobado por | pertenece a una ubicación; cita evidencias |
| `Snapshot` | fecha, tipo (línea base, recalibración, cierre de ciclo), copia de ubicaciones, cantidad de capacidades, puntaje | pertenece a un tablero; sus entradas no se editan; la de línea base solo admite agregar la entrada de cada capacidad que ingresa después |

### 4.4 Relaciones en formato Mermaid

Este bloque está pensado para que Claude Code lo lea directamente.

```
erDiagram
  MentoringFirm ||--o{ Organization : atiende
  MentoringFirm ||--o{ MapTemplate : es_duena_de
  MentoringFirm ||--o{ Person : tiene_mentores
  MapTemplate ||--o{ CapabilityMap : se_copia_en
  Organization ||--o{ Role : define
  Organization ||--o{ StrategicObjective : tiene
  Organization ||--o{ Tool : cataloga
  Organization ||--o{ Person : agrupa
  Organization ||--o{ OrganizationMembership : otorga
  Person ||--o{ OrganizationMembership : ejerce
  Role ||--o{ CapabilityMap : versiona
  CapabilityMap ||--|| MaturityScale : usa
  MaturityScale ||--|{ Level : ordena
  CapabilityMap ||--|{ Dimension : agrupa
  CapabilityMap ||--o{ BonusRule : permite
  Dimension ||--|{ Capability : contiene
  Capability }o--o{ Tool : se_apoya_en
  Capability }o--o{ StrategicObjective : apunta_a
  CapabilityMap ||--o{ Program : se_aplica_en
  Program }o--o{ Capability : seleccion_base
  Program ||--o{ Enrollment : inscribe
  Person ||--o{ Enrollment : participa
  Enrollment ||--o| Board : posee
  Enrollment ||--o{ PanelAssignment : acompana
  Board ||--o{ Placement : selecciona_y_ubica
  Placement }o--|| Capability : de
  Placement }o--o| Level : en
  Placement ||--o{ LevelChange : registra
  Placement ||--o{ BonusAward : recibe
  BonusRule ||--o{ BonusAward : se_aplica_como
  BonusAward }o--o{ Evidence : cita
  Board ||--o{ SelfAssessment : inicia_con
  Board ||--o{ CalibrationSession : calibra
  Board ||--o{ Snapshot : fotografia
  Board ||--o{ Cycle : avanza_en
  Board ||--o{ MentoringSession : recibe
  Cycle ||--o{ Focus : prioriza
  Focus }o--|| Capability : sobre
  Focus ||--|{ Experiment : se_prueba_con
  Experiment ||--o{ Evidence : produce
  LevelChange }o--o{ Evidence : cita
```

## 5. Reglas de negocio

Estas reglas son las que convierten el tablero en un instrumento confiable; el sistema debe hacerlas cumplir, no solo documentarlas.

### 5.1 Invariantes

1. **Una ubicación por capacidad.** En un tablero, cada capacidad seleccionada para el participante está en exactamente un nivel o sin ubicar. Sin ubicar es un estado válido en cualquier momento y suma cero al puntaje. Cada tablero parte de la selección base del programa, tomada del conjunto del mapa; cualquier integrante del panel puede agregarle capacidades en cualquier momento, y quitarle solo antes de fijar la línea base.
2. **La autoevaluación no es línea base.** Es una propuesta del participante y no genera puntaje oficial.
3. **La línea base nace de una calibración.** Solo se fija si asistieron el participante y los roles obligatorios del panel, y toma las capacidades seleccionadas en ese momento. Sus entradas no se editan. Después, en cualquier momento se pueden agregar capacidades nuevas al tablero: entran sin ubicar, un integrante del panel acuerda su nivel inicial con el participante, y ese nivel se agrega a la línea base original como entrada nueva. Queda registro de quién agregó la capacidad, cuándo, y de su nivelación inicial. Una recalibración posterior no reemplaza la línea base: solo produce una fotografía.
4. **Después de la línea base, ningún nivel cambia sin evidencia.** Todo cambio queda como `LevelChange` con al menos una evidencia y quién lo aprobó. Hay dos excepciones, que también quedan como `LevelChange` con quién las aprobó: la nivelación inicial de una capacidad agregada y los niveles acordados en una recalibración.
5. **El participante no aprueba sus propios cambios.** Propone; basta la aprobación de un solo integrante de su panel.
6. **Los niveles que exigen transferencia piden evidencia de haber enseñado a otros.** En el caso de origen es el nivel 4.
7. **Una bonificación solo cuenta con su condición cumplida y evidenciada.** Se registra como `BonusAward` sobre una ubicación: el participante la propone con al menos una evidencia y un integrante de su panel la aprueba. Solo las aprobadas suman, y hay a lo sumo una por regla y capacidad. En el caso de origen: usó IA para potenciar la capacidad y transfirió esa práctica a sus compañeros.
8. **Focos acotados.** Un ciclo no admite más focos que el máximo del programa, y cada foco tiene al menos un experimento.
9. **Sin comparación entre personas.** No existen rankings ni vistas que ordenen participantes por puntaje. Un tablero lo ven su dueño y su panel.
10. **Un mapa publicado solo crece.** Las dimensiones y capacidades existentes no se modifican ni se eliminan; esos cambios crean una versión nueva. Sí se pueden agregar dimensiones y capacidades nuevas en cualquier momento, y quedan disponibles para los tableros de los programas que usan ese mapa.
11. **Aislamiento por organización.** El sistema aloja varias organizaciones y ningún dato de una es visible desde otra. Los mapas plantilla son de la firma de mentores, no de las organizaciones cliente. La única excepción son las personas de la firma de mentores: son superadministradoras, crean las cuentas de las organizaciones cliente y pueden administrar dentro de ellas cuando se requiere por soporte.

### 5.2 Cálculo del puntaje de madurez

El puntaje es la suma, capacidad por capacidad, del multiplicador de su nivel más sus bonificaciones. La dificultad se muestra, pero no pondera el puntaje.

```latex
P = \sum_{c \in \text{tablero}} \left( m_{n(c)} + \sum_{b \in B(c)} e_b \right)
```

Donde `m` es el multiplicador del nivel en que está la capacidad y `e` los puntos extra de cada bonificación otorgada y aprobada. Una capacidad sin ubicar suma cero. Equivale a la fórmula del caso de origen: tarjetas por columna multiplicadas por el valor de la columna, más los puntos extra. Como cada participante tiene su propia selección de capacidades, el máximo posible es distinto para cada tablero. Al agregar capacidades ese máximo crece, así que cada fotografía guarda cuántas capacidades tenía el tablero.

Ejemplo verificado, con multiplicadores iguales al número del nivel:

| Nivel | Multiplicador | Capacidades | Subtotal |
| --- | --- | --- | --- |
| 0 | 0 | 2 | 0 |
| 1 | 1 | 3 | 3 |
| 2 | 2 | 3 | 6 |
| 3 | 3 | 1 | 3 |
| 4 | 4 | 1 | 4 |
| Bonificación por IA en una capacidad | +1 | 1 | 1 |
| **Total** |  | 10 | **17** |

El máximo de ese tablero sin bonificaciones es 40 (10 capacidades en nivel 4).

### 5.3 Cómo se muestra el puntaje

- El total siempre va junto a su evolución entre fotografías (línea base, cierres de ciclo, hoy).
- Se desglosa por dimensión, para ver dónde están las brechas.
- Se desglosa por dificultad, para que sea visible si el avance viene solo de capacidades fáciles. Ese es el propósito de la marca de dificultad en el caso de origen.

## 6. Flujos y ciclo de mejora

El sistema sostiene un flujo de preparación que ocurre una vez y un ciclo de mejora que se repite por participante.

### 6.1 Preparación (una vez por rol y programa)

1. **Diseñar el mapa.** Se definen dimensiones, capacidades observables, herramientas, escala, dificultad y bonificaciones, a partir del contexto estratégico de la organización. El mapa queda en borrador.
2. **Publicar el mapa.** Lo existente queda congelado y disponible para programas; la versión solo admite agregar dimensiones y capacidades.
3. **Crear el programa.** El diseñador del mapa selecciona, de la versión elegida, las capacidades que cubrirán a todos los participantes. Se definen las fechas y el máximo de focos por ciclo.
4. **Inscribir personas.** Se registran participantes y se asigna a cada uno su panel. Cada tablero arranca con la selección base; cualquier integrante del panel puede ajustarla para su participante. Después de fijar la línea base solo se agregan capacidades.

### 6.2 Ciclo de mejora (por participante)

1. **Autoevaluación.** El participante ubica cada capacidad en un nivel según su percepción.
2. **Calibración.** El panel contrasta cada ubicación con casos reales y se acuerdan los niveles. El sistema guarda la diferencia entre lo autoevaluado y lo acordado, y fija la línea base.
3. **Selección de focos.** Participante y panel priorizan pocas capacidades para el ciclo.
4. **Experimentos.** De cada foco sale al menos un experimento a ejecutar en el trabajo real.
5. **Mentoría.** En cada sesión se revisan los experimentos, se registran hechos y aprendizajes. Si la evidencia muestra consolidación, se aprueba el cambio de nivel.
6. **Cierre del ciclo.** Se toma una fotografía del tablero y se compara con la anterior.
7. **Nuevo ciclo.** Se vuelve al paso 3. Una recalibración completa (paso 2) es opcional al iniciar un ciclo; produce una fotografía y no reemplaza la línea base. En cualquier punto del ciclo se pueden agregar al tablero capacidades nuevas a desarrollar.

### 6.3 Estados

| Entidad | Estados y transiciones |
| --- | --- |
| Mapa de capacidades | borrador → publicado → archivado |
| Tablero | sin iniciar → autoevaluado → calibrado (con línea base) → en ciclo ⇄ entre ciclos → cerrado |
| Ciclo | planeado → activo → cerrado |
| Experimento | planteado → en curso → revisado, con resultado: consolidó, no consolidó o descartado |
| Cambio de nivel | propuesto → aprobado o rechazado |
| Bonificación otorgada | propuesta → aprobada o rechazada |

## 7. Actores y permisos

Una misma persona puede tener papeles distintos en programas distintos. Hay tres fuentes de permiso: ser de la firma de mentores (superadministrador), la membresía en una organización (administrador, diseñador del mapa) y el papel en cada programa (participante, líder, especialista, mentor).

| Actor | Qué hace | Qué ve |
| --- | --- | --- |
| Firma de mentores (superadministrador) | Crea las cuentas de las organizaciones cliente, mantiene los mapas plantilla y puede administrar dentro de una organización cuando se requiere por soporte | Sus plantillas y todas las organizaciones, con lo mismo que ve el administrador de cada una |
| Administrador de la organización | Crea roles, programas e inscripciones | Configuración y estado de avance del proceso, no el contenido de los tableros |
| Diseñador del mapa | Crea y publica versiones del mapa de capacidades; define la selección base de cada programa | Mapas de su organización |
| Participante | Se autoevalúa, propone focos, registra experimentos y evidencias, propone cambios de nivel | Su propio tablero y su historia |
| Líder | Participa en la calibración, acuerda focos, puede aprobar cambios de nivel y ajustar las capacidades del participante | Tableros de los participantes que tiene asignados |
| Especialista | Participa en la calibración, aporta criterio técnico, puede aprobar cambios de nivel y ajustar las capacidades del participante | Tableros de los participantes que tiene asignados |
| Mentor | Facilita la calibración, conduce las mentorías, puede aprobar cambios de nivel y ajustar las capacidades del participante | Tableros de los participantes que tiene asignados |

El mentor puede ser externo a la organización al comienzo e interno después; el modelo no distingue, y así se cumple el principio de capacidad instalada.

## 8. Alcance sugerido del MVP

El MVP debe permitir correr un programa real de punta a punta con un rol y un grupo pequeño; el caso de los Product Owners sirve como primer juego de datos de prueba. Esta división es una propuesta, no sale del caso de origen.

| Dentro del MVP | Fuera del MVP |
| --- | --- |
| Varias organizaciones en la misma plataforma, aisladas entre sí, y personas con más de un rol | Autoservicio para que una organización nueva se registre sola |
| Editor del mapa: dimensiones, capacidades, herramientas, escala, dificultad, bonificaciones | Biblioteca de mapas plantilla de la firma de mentores |
| Publicación de una versión del mapa | Migración de tableros entre versiones del mapa |
| Programa, inscripciones, asignación de panel, selección base de capacidades y ajuste por participante | Agenda, recordatorios y videollamadas |
| Tablero Kanban por participante | Agregado de brechas para planear formación (versión posterior) |
| Autoevaluación y calibración con línea base | Generación de mapas o de experimentos con IA |
| Focos, experimentos, evidencias y cambio de nivel aprobado | Integraciones con sistemas de talento humano |
| Puntaje, desgloses y evolución entre fotografías | Contenidos de formación o cursos |
| Inicio de sesión con cuenta de Google o de Microsoft | Inicio de sesión corporativo configurado por cada organización (SAML) |

## 9. Supuestos y decisiones abiertas

La descripción de origen no define todo; lo que sigue separa lo que se asumió de lo que conviene decidir antes de construir.

### 9.1 Supuestos tomados en este documento

| Supuesto | Por qué se tomó |
| --- | --- |
| El multiplicador de cada nivel es su número (0 a 4) | El caso de origen dice que cada nivel tiene un multiplicador, pero no da los valores |
| La bonificación por IA se generaliza a reglas de bonificación configurables | Otra organización puede querer premiar otra práctica |
| El superadministrador ve dentro de una organización lo mismo que su administrador; no ve el contenido de los tableros salvo que esté inscrito en el panel | Se pidió que pueda administrar por soporte; la invariante 9 reserva el tablero a su dueño y su panel |
| La nivelación inicial y la recalibración no exigen evidencia registrada, pero sí quedan como cambio de nivel con quién aprobó | Se aceptó la nivelación inicial como motivo; no se dijo si lleva evidencia |
| Un nivel puede bajar, pero solo en una recalibración | El caso de origen solo describe avances |
| La firma de mentores es quien crea las organizaciones cliente | Se pidió poder crear varias organizaciones, sin decir quién las crea |
| Un mapa plantilla se copia al mapa de la organización; los cambios posteriores no se sincronizan | Mantiene la plantilla como propiedad de la firma y el mapa como propio de la organización |
| "Mentor de Clear" en el texto de origen se leyó como mentor de Kleer | Parece un error de transcripción |
| Términos del dominio en español, identificadores de código en inglés | Convención habitual; se puede cambiar |
| Después de la línea base se agregan capacidades, pero no se quitan; la nueva entra sin ubicar y un integrante del panel acuerda su nivel inicial | Se pidió poder ingresar capacidades en cualquier momento; no se dijo cómo se nivelan ni si se pueden retirar |
| Un mapa publicado admite capacidades nuevas, pero no cambios ni eliminaciones de las existentes | Da la flexibilidad pedida sin alterar los tableros ni las fotografías ya registradas |

### 9.2 Decisiones tomadas el 12 de noviembre de 2026

| Tema | Decisión |
| --- | --- |
| Modelo de producto | Una plataforma preparada para crear varias organizaciones |
| Peso de la dificultad | Solo se muestra el grado de dificultad; no pondera el puntaje por ahora |
| Aprobación del cambio de nivel | Basta un solo integrante del panel |
| Selección de capacidades | El diseñador del mapa selecciona, del conjunto creado, las que cubren a todos los participantes del programa; cualquier integrante del panel puede ajustarlas por participante antes de fijar la línea base. Después se pueden agregar capacidades nuevas en cualquier momento |
| Vistas agregadas | Un agregado de brechas para planear formación, en una versión posterior |
| Mapas plantilla | Puede haberlos, pero son propiedad de la firma de mentores (Kleer), no de las organizaciones cliente |
| Una persona con varios roles | Sí se permite |
| Capacidad sin ubicar | Es válida en cualquier momento y suma cero |
| Nivel inicial de una capacidad agregada | Se registra como cambio de nivel con motivo "nivelación inicial" |
| Recalibración | Solo se toma como fotografía; no reemplaza la línea base |
| Crecimiento del mapa publicado | Se pueden agregar dimensiones y capacidades. Una capacidad activa es la que está siendo usada en un programa |
| Capacidades después de la línea base | Sin límite de tiempo para agregar. La línea base toma las capacidades elegidas en ese punto; la que entra después se agrega a la línea base original con el nivel acordado con un integrante del panel, y queda registro de su ingreso y de su calibración inicial |
| Bonificaciones | Se modelan como bonificación otorgada (`BonusAward`): propuesta, evidencia y aprobación de un integrante del panel |
| Papeles por organización | Se agrega la membresía (`OrganizationMembership`) para administrador y diseñador del mapa |
| Personas de la firma de mentores | Son superadministradoras: crean cuentas de organizaciones cliente y pueden administrar dentro de ellas por soporte |
| Autenticación | Inicio de sesión solo con cuenta de Google o de Microsoft, para delegar en ellos la autenticación; el sistema no guarda contraseñas. El acceso es por invitación |
| Tarjetas verdes del mapa de ejemplo | Son las capacidades priorizadas para la organización y el programa de ejemplo; en los datos de prueba se cargan como selección base de ese programa |
| Tecnología | Monolito modular con arquitectura hexagonal, TypeScript de punta a punta: Fastify, Zod y Drizzle en la API; React y Vite en la web; PostgreSQL con aislamiento por organización; todo en contenedores con Docker Compose |

### 9.3 Decisiones abiertas

- [ ] **Alcance del agregado de brechas.** ¿Qué ve el líder y con qué nivel de anonimato? Las selecciones distintas por participante limitan lo comparable.
- [ ] **Panel de calibración.** `PanelAssignment` necesita atributos: participante, integrante y papel.
- [ ] **Transferencia en la calibración.** ¿Fijar un nivel que exige transferencia en la línea base pide evidencia registrada?
- [ ] **Asteriscos del mapa de ejemplo.** Algunas herramientas llevan asterisco sin leyenda.

## 10. Cómo usar este documento con Claude Code

Este documento describe el qué y el porqué; el cómo se decide en Claude Code con las decisiones de la sección 9 ya resueltas.

1. Resolver las decisiones abiertas que quedan en la sección 9.3.
2. Guardar este documento en el repositorio en formato Markdown, por ejemplo en `docs/base-conceptual.md`, y referenciarlo desde `CLAUDE.md`.
3. Pedir primero un plan, no código. Un mensaje inicial posible:

```
Lee docs/base-conceptual.md. Es la base conceptual del sistema.
No escribas código todavía. Entrégame:
1. Las ambigüedades o contradicciones que encuentres en el modelo.
2. Una propuesta de arquitectura y stack para el MVP de la sección 8, con alternativas.
3. Un plan de construcción por incrementos verticales, empezando por
   mapa -> tablero -> autoevaluación -> calibración -> línea base.
Las invariantes de la sección 5.1 deben quedar cubiertas por pruebas automatizadas.
```

4. Cargar el mapa de los Product Owners como datos de prueba, para validar el modelo genérico contra el caso real.
