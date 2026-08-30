/**
 * WebGL post-process: takes the 2D radar canvas as a texture each frame and
 * applies barrel distortion, scanlines, chromatic aberration, cheap bloom,
 * vignette and flicker. Phase Two turns all of it down to near-zero so the
 * image goes flat and clinical.
 */
const VS = `attribute vec2 p; varying vec2 v; void main(){ v = p*0.5+0.5; gl_Position = vec4(p,0.,1.); }`
const FS = `
precision mediump float;
uniform sampler2D u_tex; uniform vec2 u_res; uniform float u_time;
uniform float u_curve; uniform float u_scan; uniform float u_bloom; uniform float u_aberr; uniform float u_vig; uniform float u_flicker;
varying vec2 v;
vec2 barrel(vec2 uv){ vec2 c = uv*2.0-1.0; float r2 = dot(c,c); c *= 1.0 + u_curve*r2; return c*0.5+0.5; }
void main(){
  vec2 uv = barrel(v);
  if(uv.x<0.||uv.x>1.||uv.y<0.||uv.y>1.){ gl_FragColor = vec4(0.,0.,0.,1.); return; }
  vec2 px = 1.0/u_res;
  vec3 col;
  col.r = texture2D(u_tex, uv + vec2(u_aberr,0.)).r;
  col.g = texture2D(u_tex, uv).g;
  col.b = texture2D(u_tex, uv - vec2(u_aberr,0.)).b;
  vec3 bl = vec3(0.);
  bl += texture2D(u_tex, uv + px*vec2( 2., 0.)).rgb;
  bl += texture2D(u_tex, uv + px*vec2(-2., 0.)).rgb;
  bl += texture2D(u_tex, uv + px*vec2( 0., 2.)).rgb;
  bl += texture2D(u_tex, uv + px*vec2( 0.,-2.)).rgb;
  bl += texture2D(u_tex, uv + px*vec2( 4., 4.)).rgb;
  bl += texture2D(u_tex, uv + px*vec2(-4.,-4.)).rgb;
  col += bl * (u_bloom/6.0);
  float scan = 1.0 - u_scan * (0.5 + 0.5*sin(uv.y*u_res.y*1.5707963));
  col *= scan;
  float d = length(v*2.0-1.0);
  col *= mix(1.0, smoothstep(1.35, 0.4, d), u_vig);
  col *= 1.0 - u_flicker*(0.5+0.5*sin(u_time*113.0)) * 0.06;
  gl_FragColor = vec4(col, 1.0);
}`

export interface CrtParams { curve: number; scan: number; bloom: number; aberr: number; vig: number; flicker: number }
export const PHASE1: CrtParams = { curve: 0.11, scan: 0.22, bloom: 0.9, aberr: 0.0011, vig: 1, flicker: 1 }
export const PHASE2: CrtParams = { curve: 0.0, scan: 0.0, bloom: 0.15, aberr: 0.0, vig: 0.2, flicker: 0 }

export class Crt {
  private gl: WebGLRenderingContext
  private prog: WebGLProgram
  private tex: WebGLTexture
  private u: Record<string, WebGLUniformLocation | null> = {}
  params: CrtParams = { ...PHASE1 }
  private target: CrtParams = { ...PHASE1 }

  constructor(private out: HTMLCanvasElement, private src: HTMLCanvasElement) {
    const gl = out.getContext('webgl', { antialias: false, premultipliedAlpha: false })
    if (!gl) throw new Error('no webgl')
    this.gl = gl
    const sh = (t: number, s: string) => { const o = gl.createShader(t)!; gl.shaderSource(o, s); gl.compileShader(o); if (!gl.getShaderParameter(o, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(o) ?? 'shader'); return o }
    const p = gl.createProgram()!
    gl.attachShader(p, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, FS)); gl.linkProgram(p)
    this.prog = p
    gl.useProgram(p)
    const buf = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, buf)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW)
    const loc = gl.getAttribLocation(p, 'p')
    gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0)
    this.tex = gl.createTexture()!
    gl.bindTexture(gl.TEXTURE_2D, this.tex)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true)
    for (const n of ['u_tex', 'u_res', 'u_time', 'u_curve', 'u_scan', 'u_bloom', 'u_aberr', 'u_vig', 'u_flicker']) this.u[n] = gl.getUniformLocation(p, n)
  }

  /** Smoothly transition to a parameter set (used for the Phase Two curtain-pull). */
  setTarget(t: CrtParams) { this.target = { ...t } }

  draw(time: number) {
    const gl = this.gl
    const k = 0.08
    for (const key of Object.keys(this.params) as (keyof CrtParams)[]) this.params[key] += (this.target[key] - this.params[key]) * k
    if (this.out.width !== this.src.width || this.out.height !== this.src.height) { this.out.width = this.src.width; this.out.height = this.src.height }
    gl.viewport(0, 0, this.out.width, this.out.height)
    gl.bindTexture(gl.TEXTURE_2D, this.tex)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.src)
    gl.uniform1i(this.u.u_tex, 0)
    gl.uniform2f(this.u.u_res, this.out.width, this.out.height)
    gl.uniform1f(this.u.u_time, time)
    const p = this.params
    gl.uniform1f(this.u.u_curve, p.curve); gl.uniform1f(this.u.u_scan, p.scan); gl.uniform1f(this.u.u_bloom, p.bloom)
    gl.uniform1f(this.u.u_aberr, p.aberr); gl.uniform1f(this.u.u_vig, p.vig); gl.uniform1f(this.u.u_flicker, p.flicker)
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
  }
}
