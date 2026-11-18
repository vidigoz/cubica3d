/* Geometría del marco de fotos (herramienta «Marco de fotos»).
 *
 * El marco son dos piezas con STL propios (stl/Frame/):
 *   · Bottom Frame: la placa de atrás. Se usa tal cual (sólo cambia su color).
 *   · Top Frame: el marco de adelante. Su STL trae un cuerpo grande —un campo a 4 mm
 *     con la ventana ovalada y el agujero del llavero, y un reborde de 2 mm de ancho
 *     que sube hasta 5 mm— y, encima, las letras de ejemplo («Feliz navidad»).
 *
 * Lo que hace este archivo, sin tocar el DOM (se prueba en node):
 *   1. leerSTL: STL binario -> triángulos (9 números por triángulo).
 *   2. cuerpoDelMarco: del Top Frame se queda con el cuerpo grande y tira las letras.
 *   3. dividirMarco: parte ese cuerpo en la «pieza» (campo, de 0 a 4 mm) y el «borde»
 *      (el reborde, de 4 a 5 mm) para que cada una se imprima de su color.
 *   4. textoEnArco: convierte un texto en una malla de letras (contornos de una fuente
 *      TrueType/OpenType, doblados sobre un arco concéntrico con la ventana, con las
 *      letras mirando hacia el centro, como una sonrisa).
 *   5. escribirSTL: triángulos -> STL binario.
 *
 * Ejes: el STL está acostado: X es el lado largo (el agujero del llavero queda en X≈6 y
 * el texto en X≈130) e Y el corto. Vista desde arriba, la pantalla gira el marco:
 * derecha = +Y, abajo = +X (ver js/views/marco.js). Se expone como window.Marco. */
(function () {
  'use strict';

  /* ------------------------------ Medidas del modelo ------------------------------ */

  var MEDIDAS = {
    zCampo: 4,            // la cara de arriba del campo (donde se pone el color de la pieza)
    zBorde: 5,            // lo alto del reborde
    zTextoBase: 3.4,      // el texto arranca un poco abajo del campo (queda incrustado)
    zTextoTope: 6,        // y sube 1 mm más que el reborde
    centroY: 44.29,       // el eje de simetría del marco
    arco: { apice: 129.65, radio: 37.5 }   // dónde queda la línea base del texto de ejemplo
  };

  var EPS = 1e-4;

  /* ------------------------------------ STL ------------------------------------ */

  // ArrayBuffer (o Buffer de node) de un STL binario -> Float32Array de triángulos.
  function leerSTL(buffer) {
    var ab = buffer.buffer && buffer.byteLength !== undefined && !(buffer instanceof ArrayBuffer)
      ? buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)
      : buffer;
    var vista = new DataView(ab);
    var n = vista.getUint32(80, true);
    if (84 + n * 50 !== ab.byteLength) throw new Error('El STL no es binario o está dañado.');
    var tri = new Float32Array(n * 9);
    for (var i = 0; i < n; i++) {
      var base = 84 + i * 50 + 12;   // se salta la normal
      for (var k = 0; k < 9; k++) tri[i * 9 + k] = vista.getFloat32(base + k * 4, true);
    }
    return tri;
  }

  // Triángulos (Float32Array o arreglo plano) -> STL binario (ArrayBuffer).
  function escribirSTL(tri, nombre) {
    var n = tri.length / 9;
    var ab = new ArrayBuffer(84 + n * 50);
    var vista = new DataView(ab);
    var cab = String(nombre || 'Cubica3D');
    for (var c = 0; c < Math.min(cab.length, 79); c++) vista.setUint8(c, cab.charCodeAt(c) & 0x7f);
    vista.setUint32(80, n, true);
    for (var i = 0; i < n; i++) {
      var o = i * 9;
      var ux = tri[o + 3] - tri[o], uy = tri[o + 4] - tri[o + 1], uz = tri[o + 5] - tri[o + 2];
      var vx = tri[o + 6] - tri[o], vy = tri[o + 7] - tri[o + 1], vz = tri[o + 8] - tri[o + 2];
      var nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      var largo = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
      var p = 84 + i * 50;
      vista.setFloat32(p, nx / largo, true);
      vista.setFloat32(p + 4, ny / largo, true);
      vista.setFloat32(p + 8, nz / largo, true);
      for (var k = 0; k < 9; k++) vista.setFloat32(p + 12 + k * 4, tri[o + k], true);
    }
    return ab;
  }

  /* --------------------------- El cuerpo del Top Frame --------------------------- */

  // Parte la malla en cuerpos sueltos (piezas que no comparten vértices) y devuelve los
  // triángulos del más grande (por tamaño de su caja): el marco; lo demás son las letras.
  function cuerpoDelMarco(tri) {
    var n = tri.length / 9;
    var mapa = {};
    var ids = new Int32Array(n * 3);
    var total = 0;
    for (var i = 0; i < n * 3; i++) {
      var clave = tri[i * 3].toFixed(3) + ',' + tri[i * 3 + 1].toFixed(3) + ',' + tri[i * 3 + 2].toFixed(3);
      var id = mapa[clave];
      if (id === undefined) { id = total++; mapa[clave] = id; }
      ids[i] = id;
    }
    var padre = new Int32Array(total);
    for (var p = 0; p < total; p++) padre[p] = p;
    function raiz(x) { while (padre[x] !== x) { padre[x] = padre[padre[x]]; x = padre[x]; } return x; }
    for (var t = 0; t < n; t++) {
      var a = raiz(ids[t * 3]);
      for (var k = 1; k < 3; k++) { var b = raiz(ids[t * 3 + k]); if (a !== b) padre[b] = a; }
    }
    var cajas = {};
    for (var t2 = 0; t2 < n; t2++) {
      var r = raiz(ids[t2 * 3]);
      var caja = cajas[r] || (cajas[r] = { tris: [], x0: Infinity, x1: -Infinity, y0: Infinity, y1: -Infinity });
      caja.tris.push(t2);
      for (var q = 0; q < 3; q++) {
        var x = tri[t2 * 9 + q * 3], y = tri[t2 * 9 + q * 3 + 1];
        if (x < caja.x0) caja.x0 = x; if (x > caja.x1) caja.x1 = x;
        if (y < caja.y0) caja.y0 = y; if (y > caja.y1) caja.y1 = y;
      }
    }
    var mejor = null;
    Object.keys(cajas).forEach(function (k) {
      var c = cajas[k];
      c.area = (c.x1 - c.x0) * (c.y1 - c.y0);
      if (!mejor || c.area > mejor.area) mejor = c;
    });
    var salida = new Float32Array(mejor.tris.length * 9);
    mejor.tris.forEach(function (t3, j) { salida.set(tri.subarray(t3 * 9, t3 * 9 + 9), j * 9); });
    return salida;
  }

  /* --------------------------- Cortar la malla en un plano z --------------------------- */

  // Corta un triángulo con el plano z = zc: devuelve los triángulos de abajo (z <= zc) y
  // los de arriba (z >= zc). Los que ya están en el plano se asignan por su normal.
  function cortarTriangulo(t, zc, abajo, arriba) {
    var z0 = t[2], z1 = t[5], z2 = t[8];
    var lo = Math.min(z0, z1, z2), hi = Math.max(z0, z1, z2);
    if (hi <= zc + EPS) { abajo.push(t); return; }
    if (lo >= zc - EPS) {
      if (hi - lo < EPS && Math.abs(lo - zc) < EPS) {
        // en el plano de corte: si mira hacia arriba es la tapa de lo de abajo
        var nz = (t[3] - t[0]) * (t[7] - t[1]) - (t[4] - t[1]) * (t[6] - t[0]);
        (nz >= 0 ? abajo : arriba).push(t);
      } else arriba.push(t);
      return;
    }
    var P = [[t[0], t[1], t[2]], [t[3], t[4], t[5]], [t[6], t[7], t[8]]];
    function lado(poli, queda) {
      var salida = [];
      for (var i = 0; i < poli.length; i++) {
        var a = poli[i], b = poli[(i + 1) % poli.length];
        var da = a[2] - zc, db = b[2] - zc;
        if (queda(da)) salida.push(a);
        if ((da < 0 && db > 0) || (da > 0 && db < 0)) {
          var u = da / (da - db);
          salida.push([a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, zc]);
        }
      }
      return salida;
    }
    function abanico(poli, destino) {
      for (var i = 1; i + 1 < poli.length; i++) {
        destino.push([poli[0][0], poli[0][1], poli[0][2], poli[i][0], poli[i][1], poli[i][2],
          poli[i + 1][0], poli[i + 1][1], poli[i + 1][2]]);
      }
    }
    abanico(lado(P, function (d) { return d <= 0; }), abajo);
    abanico(lado(P, function (d) { return d >= 0; }), arriba);
  }

  // ¿El triángulo es horizontal, a la altura z y mirando hacia arriba?
  function esTapaArriba(t, z) {
    if (Math.abs(t[2] - z) > EPS || Math.abs(t[5] - z) > EPS || Math.abs(t[8] - z) > EPS) return false;
    return (t[3] - t[0]) * (t[7] - t[1]) - (t[4] - t[1]) * (t[6] - t[0]) > 0;
  }

  function aPlano(listas) {
    var total = 0;
    listas.forEach(function (l) { total += l.length; });
    var out = new Float32Array(total * 9);
    var j = 0;
    listas.forEach(function (l) { l.forEach(function (t) { out.set(t, j); j += 9; }); });
    return out;
  }

  // Los lazos (contornos cerrados) que forman las aristas del borde de un conjunto de
  // triángulos horizontales: cada lazo es una lista ordenada de [x, y].
  function lazosDe(tris) {
    var aristas = {};
    function clave(x, y) { return x.toFixed(3) + ',' + y.toFixed(3); }
    var coord = {};
    tris.forEach(function (t) {
      for (var k = 0; k < 3; k++) {
        var ax = t[k * 3], ay = t[k * 3 + 1], bx = t[((k + 1) % 3) * 3], by = t[((k + 1) % 3) * 3 + 1];
        var a = clave(ax, ay), b = clave(bx, by);
        coord[a] = [ax, ay]; coord[b] = [bx, by];
        var id = a < b ? a + '|' + b : b + '|' + a;
        aristas[id] = (aristas[id] || 0) + 1;
      }
    });
    var vecinos = {};
    Object.keys(aristas).forEach(function (id) {
      if (aristas[id] !== 1) return;
      var ab = id.split('|');
      (vecinos[ab[0]] = vecinos[ab[0]] || []).push(ab[1]);
      (vecinos[ab[1]] = vecinos[ab[1]] || []).push(ab[0]);
    });
    var vistos = {}, lazos = [];
    Object.keys(vecinos).forEach(function (inicio) {
      if (vistos[inicio]) return;
      var lazo = [], actual = inicio, previo = null;
      while (actual && !vistos[actual]) {
        vistos[actual] = true;
        lazo.push(coord[actual]);
        var sig = null;
        for (var v = 0; v < vecinos[actual].length; v++) {
          if (vecinos[actual][v] !== previo && !vistos[vecinos[actual][v]]) { sig = vecinos[actual][v]; break; }
        }
        previo = actual; actual = sig;
      }
      if (lazo.length >= 3) lazos.push(lazo);
    });
    return lazos;
  }

  // El cuerpo del marco partido en dos piezas cerradas:
  //   pieza: el campo, de z = 0 a 4 (con la ventana y el agujero del llavero);
  //   borde: el reborde, de z = 4 a 5.
  // Cada una necesita su tapa en z = 4 donde estaba el reborde: es la misma huella de la
  // cara de arriba del reborde, copiada a esa altura. La pared de afuera, que en el STL
  // va de 0 a 5 de un tirón, se rehace en dos tramos desde su contorno, para que las
  // aristas de las dos piezas coincidan exactamente.
  function dividirMarco(cuerpo) {
    var n = cuerpo.length / 9;
    var zc = MEDIDAS.zCampo, zb = MEDIDAS.zBorde;
    var abajo = [], arriba = [], huella = [], zMin = Infinity;
    for (var i = 0; i < n; i++) {
      var t = Array.prototype.slice.call(cuerpo, i * 9, i * 9 + 9);
      zMin = Math.min(zMin, t[2], t[5], t[8]);
      if (esTapaArriba(t, zb)) huella.push(t);
      var lo = Math.min(t[2], t[5], t[8]), hi = Math.max(t[2], t[5], t[8]);
      if (lo < zc - EPS && hi > zc + EPS) continue;       // pared de afuera: se rehace abajo
      cortarTriangulo(t, zc, abajo, arriba);
    }
    huella.forEach(function (t) {
      // tapa de la pieza (mira hacia arriba) y tapa del borde (mira hacia abajo)
      abajo.push([t[0], t[1], zc, t[3], t[4], zc, t[6], t[7], zc]);
      arriba.push([t[0], t[1], zc, t[6], t[7], zc, t[3], t[4], zc]);
    });

    // La pared de afuera: el lazo más grande de la huella.
    var lazos = lazosDe(huella), afuera = null, mayor = -1;
    lazos.forEach(function (l) {
      var a = Math.abs(areaFirmada(l));
      if (a > mayor) { mayor = a; afuera = l; }
    });
    if (afuera) {
      var anti = areaFirmada(afuera) > 0;
      for (var k = 0; k < afuera.length; k++) {
        var p = afuera[k], q = afuera[(k + 1) % afuera.length];
        if (!anti) { var tmp = p; p = q; q = tmp; }
        [[zMin, zc, abajo], [zc, zb, arriba]].forEach(function (tramo) {
          tramo[2].push([p[0], p[1], tramo[0], q[0], q[1], tramo[0], q[0], q[1], tramo[1]]);
          tramo[2].push([p[0], p[1], tramo[0], q[0], q[1], tramo[1], p[0], p[1], tramo[1]]);
        });
      }
    }
    return { pieza: aPlano([abajo]), borde: aPlano([arriba]) };
  }

  /* --------------------------------- Texto en arco --------------------------------- */

  // Un contorno (arreglo de [x, y]) a lista plana.
  function areaFirmada(poli) {
    var a = 0;
    for (var i = 0; i < poli.length; i++) {
      var p = poli[i], q = poli[(i + 1) % poli.length];
      a += p[0] * q[1] - q[0] * p[1];
    }
    return a / 2;
  }

  function puntoEnPoligono(px, py, poli) {
    var dentro = false;
    for (var i = 0, j = poli.length - 1; i < poli.length; j = i++) {
      var xi = poli[i][0], yi = poli[i][1], xj = poli[j][0], yj = poli[j][1];
      if (((yi > py) !== (yj > py)) && (px < (xj - xi) * (py - yi) / (yj - yi) + xi)) dentro = !dentro;
    }
    return dentro;
  }

  // Los comandos de una letra (opentype) -> contornos de puntos, en mm, con y hacia
  // arriba. Las curvas se reparten en tramos y las rectas largas se parten en pedazos
  // de ≤ 0.4 mm: así, al doblar el texto sobre el arco, no quedan chuecas.
  function contornosDe(comandos, escala, ox) {
    var contornos = [], actual = null, ax = 0, ay = 0;
    function punto(x, y) { return [ox + x * escala, y * escala]; }
    function recta(x, y) {
      var p0 = actual[actual.length - 1];
      var p1 = punto(x, y);
      var largo = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
      var partes = Math.max(1, Math.ceil(largo / 0.4));
      for (var s = 1; s <= partes; s++) {
        actual.push([p0[0] + (p1[0] - p0[0]) * s / partes, p0[1] + (p1[1] - p0[1]) * s / partes]);
      }
    }
    comandos.forEach(function (c) {
      if (c.type === 'M') { actual = [punto(c.x, c.y)]; contornos.push(actual); ax = c.x; ay = c.y; }
      else if (c.type === 'L') { recta(c.x, c.y); ax = c.x; ay = c.y; }
      else if (c.type === 'Q') {
        for (var s = 1; s <= 10; s++) {
          var u = s / 10, m = 1 - u;
          actual.push(punto(m * m * ax + 2 * m * u * c.x1 + u * u * c.x, m * m * ay + 2 * m * u * c.y1 + u * u * c.y));
        }
        ax = c.x; ay = c.y;
      } else if (c.type === 'C') {
        for (var s2 = 1; s2 <= 12; s2++) {
          var u2 = s2 / 12, m2 = 1 - u2;
          actual.push(punto(
            m2 * m2 * m2 * ax + 3 * m2 * m2 * u2 * c.x1 + 3 * m2 * u2 * u2 * c.x2 + u2 * u2 * u2 * c.x,
            m2 * m2 * m2 * ay + 3 * m2 * m2 * u2 * c.y1 + 3 * m2 * u2 * u2 * c.y2 + u2 * u2 * u2 * c.y));
        }
        ax = c.x; ay = c.y;
      } else if (c.type === 'Z') { /* se cierra solo */ }
    });
    return contornos.filter(function (c) {
      if (c.length > 1) {
        var a = c[0], b = c[c.length - 1];
        if (Math.hypot(a[0] - b[0], a[1] - b[1]) < 1e-6) c.pop();   // el último repite al primero
      }
      return c.length >= 3 && Math.abs(areaFirmada(c)) > 1e-6;
    });
  }

  /* Dobla un punto del texto (x a lo largo de la línea, y hacia arriba) sobre el arco:
       ángulo = x / R   ·   radio = R - y   (las letras miran hacia el centro).
     Con R enorme es una recta. El centro del arco queda en (apice - R, centroY) y el
     texto se lee de +Y a -Y... de izquierda a derecha en la pantalla (derecha = +Y). */
  function doblar(p, arco) {
    var ang = p[0] / arco.radio;
    var r = arco.radio - p[1];
    return [arco.cx + r * Math.cos(ang), arco.cy + r * Math.sin(ang)];
  }

  // Los triángulos de UNA letra extruida (varias regiones con huecos). `contornos` ya
  // están doblados y en mm, y se les da la orientación correcta aquí.
  function extruirContornos(contornos, z0, z1, earcut) {
    var tris = [];
    // profundidad de anidamiento: par = región exterior, impar = hueco
    var info = contornos.map(function (c, i) {
      var prof = 0, padre = -1, areaPadre = Infinity;
      for (var j = 0; j < contornos.length; j++) {
        if (j === i) continue;
        if (puntoEnPoligono(c[0][0], c[0][1], contornos[j])) {
          prof++;
          var aj = Math.abs(areaFirmada(contornos[j]));
          if (aj < areaPadre) { areaPadre = aj; padre = j; }
        }
      }
      return { c: c, prof: prof, padre: padre };
    });
    function orientar(c, antihorario) {
      return (areaFirmada(c) > 0) === antihorario ? c : c.slice().reverse();
    }
    info.forEach(function (o, i) {
      var esHueco = o.prof % 2 === 1;
      o.anillo = orientar(o.c, !esHueco);   // exterior antihorario, hueco horario
      o.hueco = esHueco;
    });

    // paredes
    info.forEach(function (o) {
      var a = o.anillo;
      for (var i = 0; i < a.length; i++) {
        var p = a[i], q = a[(i + 1) % a.length];
        tris.push([p[0], p[1], z0, q[0], q[1], z0, q[0], q[1], z1]);
        tris.push([p[0], p[1], z0, q[0], q[1], z1, p[0], p[1], z1]);
      }
    });

    // tapas: cada región exterior con sus huecos directos
    info.forEach(function (o, i) {
      if (o.hueco) return;
      var huecos = info.filter(function (h) { return h.hueco && h.padre === i; });
      var plano = [], indices = [];
      o.anillo.forEach(function (p) { plano.push(p[0], p[1]); });
      huecos.forEach(function (h) {
        indices.push(plano.length / 2);
        h.anillo.forEach(function (p) { plano.push(p[0], p[1]); });
      });
      var res = earcut(plano, indices.length ? indices : null, 2);
      for (var t = 0; t < res.length; t += 3) {
        var a = res[t] * 2, b = res[t + 1] * 2, c = res[t + 2] * 2;
        var area = (plano[b] - plano[a]) * (plano[c + 1] - plano[a + 1]) - (plano[c] - plano[a]) * (plano[b + 1] - plano[a + 1]);
        if (Math.abs(area) < 1e-12) continue;
        var ccw = area > 0;
        // arriba mira hacia +z (antihorario); abajo hacia -z
        var A = [plano[a], plano[a + 1]], B = ccw ? [plano[b], plano[b + 1]] : [plano[c], plano[c + 1]],
          C = ccw ? [plano[c], plano[c + 1]] : [plano[b], plano[b + 1]];
        tris.push([A[0], A[1], z1, B[0], B[1], z1, C[0], C[1], z1]);
        tris.push([A[0], A[1], z0, C[0], C[1], z0, B[0], B[1], z0]);
      }
    });
    return tris;
  }

  /* El texto como malla.
       fuente  — una fuente de opentype.js (ya cargada)
       texto   — lo que se escribe (una sola línea)
       op      — { tamano: mm de la «M» (el cuerpo de la letra), radio: curvatura del arco
                   en mm (mientras más grande, más recto), apice: X de la línea base en el
                   centro, giro: grados para correr el texto por el arco, cursiva: 0..0.4
                   (inclinación artificial), grosor: mm que se engrosa el trazo (por ahora 0) }
     Devuelve { tris: Float32Array, letras, faltan: [caracteres sin glifo], ancho } */
  function textoEnArco(fuente, texto, op, earcut) {
    op = op || {};
    var radio = Math.max(8, op.radio || MEDIDAS.arco.radio);
    var arco = {
      radio: radio,
      cx: (op.apice == null ? MEDIDAS.arco.apice : op.apice) - radio,
      cy: MEDIDAS.centroY
    };
    var escala = (op.tamano || 10) / fuente.unitsPerEm;
    var inclinacion = op.cursiva || 0;
    var z0 = op.z0 == null ? MEDIDAS.zTextoBase : op.z0;
    var z1 = op.z1 == null ? MEDIDAS.zTextoTope : op.z1;
    var giro = (op.giro || 0) * Math.PI / 180;

    var glifos = fuente.stringToGlyphs(String(texto || ''));
    var faltan = [];
    var pos = [], x = 0;
    glifos.forEach(function (g, i) {
      if (g.index === 0 && String(texto)[i] && String(texto)[i] !== ' ') faltan.push(String(texto)[i]);
      pos.push(x);
      var adelanto = (g.advanceWidth || 0) * escala;
      var sig = glifos[i + 1];
      if (sig) adelanto += fuente.getKerningValue(g, sig) * escala;
      x += adelanto;
    });
    var ancho = x;
    var salida = [];
    var letras = 0;
    glifos.forEach(function (g, i) {
      if (!g.path || !g.path.commands || !g.path.commands.length) return;
      var conts = contornosDe(g.path.commands, escala, pos[i] - ancho / 2);
      if (!conts.length) return;
      letras++;
      var dobl = conts.map(function (c) {
        return c.map(function (p) {
          var xx = p[0] + inclinacion * p[1];                    // cursiva: inclina hacia la derecha
          var q = doblar([xx, p[1]], arco);
          if (giro) {                                            // correr el texto por el arco
            var dx = q[0] - arco.cx, dy = q[1] - arco.cy;
            q = [arco.cx + dx * Math.cos(giro) - dy * Math.sin(giro), arco.cy + dx * Math.sin(giro) + dy * Math.cos(giro)];
          }
          return q;
        });
      });
      extruirContornos(dobl, z0, z1, earcut).forEach(function (t) { salida.push(t); });
    });
    return { tris: aPlano([salida]), letras: letras, faltan: faltan, ancho: ancho };
  }

  // Lo que mide a lo largo (mm) un texto escrito a ese tamaño, con kerning y ligaduras.
  function anchoDeTexto(fuente, texto, tamano) {
    var escala = tamano / fuente.unitsPerEm;
    var glifos = fuente.stringToGlyphs(String(texto || ''));
    var x = 0;
    glifos.forEach(function (g, i) {
      x += (g.advanceWidth || 0) * escala;
      if (glifos[i + 1]) x += fuente.getKerningValue(g, glifos[i + 1]) * escala;
    });
    return x;
  }

  // El tamaño de letra más grande (hasta `maximo`) con el que el texto cabe en `ancho`
  // mm a lo largo del arco; de medio en medio milímetro y nunca menos de 5.
  function tamanoAjustado(fuente, texto, maximo, ancho) {
    maximo = maximo || 13;
    ancho = ancho || 66;
    var w = anchoDeTexto(fuente, texto, maximo);
    if (!w || w <= ancho) return maximo;
    return Math.max(5, Math.floor(maximo * ancho / w * 2) / 2);
  }

  /* --------------------------------- Utilidades --------------------------------- */

  function cajaDe(tri) {
    var c = { x0: Infinity, x1: -Infinity, y0: Infinity, y1: -Infinity, z0: Infinity, z1: -Infinity };
    for (var i = 0; i < tri.length; i += 3) {
      if (tri[i] < c.x0) c.x0 = tri[i]; if (tri[i] > c.x1) c.x1 = tri[i];
      if (tri[i + 1] < c.y0) c.y0 = tri[i + 1]; if (tri[i + 1] > c.y1) c.y1 = tri[i + 1];
      if (tri[i + 2] < c.z0) c.z0 = tri[i + 2]; if (tri[i + 2] > c.z1) c.z1 = tri[i + 2];
    }
    return c;
  }

  // Volumen de una malla cerrada (mm³): sirve para comprobar que las piezas cierran.
  function volumen(tri) {
    var v = 0;
    for (var i = 0; i < tri.length; i += 9) {
      v += (tri[i] * (tri[i + 4] * tri[i + 8] - tri[i + 5] * tri[i + 7]) -
        tri[i + 1] * (tri[i + 3] * tri[i + 8] - tri[i + 5] * tri[i + 6]) +
        tri[i + 2] * (tri[i + 3] * tri[i + 7] - tri[i + 4] * tri[i + 6])) / 6;
    }
    return v;
  }

  var api = {
    MEDIDAS: MEDIDAS,
    leerSTL: leerSTL,
    escribirSTL: escribirSTL,
    cuerpoDelMarco: cuerpoDelMarco,
    dividirMarco: dividirMarco,
    textoEnArco: textoEnArco,
    anchoDeTexto: anchoDeTexto,
    tamanoAjustado: tamanoAjustado,
    cajaDe: cajaDe,
    volumen: volumen
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.Marco = api;
})();
