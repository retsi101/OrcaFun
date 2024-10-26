//
//Copyright (c) 2024 Victor F. Gomes / Github @retsi101
//
//Permission is hereby granted, free of charge, to any person
//obtaining a copy of this software and associated documentation
//files (the "Software"), to deal in the Software without
//restriction, including without limitation the rights to use,
//copy, modify, merge, publish, distribute, sublicense, and/or sell
//copies of the Software, and to permit persons to whom the
//Software is furnished to do so, subject to the following
//conditions:
//
//The above copyright notice and this permission notice shall be
//included in all copies or substantial portions of the Software.
//
//THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
//EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES
//OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
//NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT
//HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY,
//WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
//FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR
//OTHER DEALINGS IN THE SOFTWARE.
//

//I decided I'll never be completely satisfied with this thing
//because turns out if you don't know math and physics, you're bound to struggle
//to make this type of creature movement look organic/convincing.
//So... consider this an eternal work in progress, god dang it. Have fun.

import * as Three from "three"
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js"

class Range {
  constructor(min, max) {
    this.min = min
    this.max = max
  }

  percent(value) {
    const min = this.min
    const max = this.max
    const v = value

    let absMin = Math.min(min, max) + Math.abs(max) + Math.abs(min)
    let absMax = Math.max(min, max) + Math.abs(max) + Math.abs(min) 
    let absV = v + Math.abs(max) + Math.abs(min)

    let coeff = 1 / ((absMin+absMax) / absV)

    return coeff
  }

  copy(other) {
    this.min = other.min
    this.max = other.max
  }

  adjust(min, max) {
    this.min = Math.min(this.min, min)
    this.max = Math.max(this.max, max)
  }

  toString() {
    return `Range(${this.min}, ${this.max})`
  }
}

class Orca {
  constructor(app) {
    this.app = app
    this.mesh = null
    this.cachedVertices = []
    this.currentVertex = new Three.Vector3()
    
    this.geometryZExtent = new Range()
    this.points = Array.from({length: 14}, _ => new Three.Vector3())
    this.joints = new Three.CatmullRomCurve3(this.points, false, 'chordal', 0.9)
    
    this.orcaToMouse = new Three.Vector3()
    this.mousePosition = new Three.Vector3()
    this.mouseOffset = new Three.Vector3(0, 0.1, 8)

    this.pitchFactor = 0.85
    this.rollFactor = 0.7
    this.yawFactor = 0.85

    this.globalBodyCurveTension = new Three.Vector3(0.6, 0.7, 0) // 0.7, 0.8, 0
    this.globalBodyCurveIntensity = new Three.Vector3(6, 6, 0) // 7, 7, 0
    this.globalMouseLerpFactor = 0.09 // 0.07
    this.globalOrcaToMouseLerpFactor = 0.09 // 0.04
    this.globalJointLerpFactor = 0.17 //0.1 // 0.2

    this.smoothPosition = new Three.Vector3()
  }

  init(mesh) {
    this.mesh = mesh
    if (!this.mesh) {
      throw 'Orca.init expects a non null argument: mesh.'
      return
    }
    this.mesh.material.map.anisotropy = this.app.renderer.capabilities.getMaxAnisotropy()
    this.cachedVertices = this.getGeometryVertices(this.mesh.geometry)
    this.geometryZExtent.copy(this.getGeometryZExtent(this.mesh.geometry))
    this.mousePosition.copy(this.app.mousePosition).add(this.mouseOffset)
    this.mesh.position.copy(this.mousePosition)
  }
  
  getGeometryVertices(geometry) {
    const positionAttribute = geometry.getAttribute("position")
    const vertices = []

    for (let i = 0; i < positionAttribute.count; i++) {
      let vertex = new Three.Vector3()
      vertex.fromBufferAttribute(positionAttribute, i)
      vertices.push(vertex)
    }

    return vertices
  }
  
  getGeometryZExtent(geometry) {
    const positionAttribute = geometry.getAttribute("position")
    var vertex = new Three.Vector3()
    let range = new Range(Infinity, -Infinity)

    for (let i = 0; i < positionAttribute.count; i++) {
      vertex.fromBufferAttribute(positionAttribute, i)
      range.adjust(vertex.z, vertex.z)
    }

    return range
  }

  update(elapsed) {
    this.mousePosition.copy(this.app.mousePosition).add(this.mouseOffset)
    this.mesh.position.lerp(this.mousePosition, this.globalMouseLerpFactor)

    this.orcaToMouse.subVectors(this.mousePosition, this.mesh.position)
    this.smoothPosition.lerp(this.orcaToMouse, this.globalOrcaToMouseLerpFactor)

    const angle = Math.atan2(this.smoothPosition.y, this.smoothPosition.x)
    let length = this.smoothPosition.length()

    this.mesh.rotation.set(
      -Math.sin(angle) * length * this.pitchFactor,
      +Math.cos(angle) * length * this.yawFactor,
      -Math.cos(angle) * length * this.rollFactor
    )

    const firstJoint = this.joints.points[0]
    firstJoint.lerp(this.smoothPosition, 0.9) 
      
    for (let i = 1; i < this.joints.points.length; i++) {
      const n = this.joints.points[i]
      const nPrev = this.joints.points[i-1]
      n.z = i
      n.lerp(nPrev, this.globalJointLerpFactor)
    }

    this.joints.updateArcLengths()

    const cached = this.cachedVertices
    const v = this.currentVertex
    const currentJoint = new Three.Vector3()
    const positionAttribute = this.mesh.geometry.getAttribute('position')
    for (let i = 0; i < positionAttribute.count; i++) {
      v.copy(cached[i])

      let coeff = 1-this.geometryZExtent.percent(v.z)
      this.joints.getPointAt(coeff, currentJoint)

      let jx = currentJoint.x * currentJoint.z * this.globalBodyCurveIntensity.x
      let jy = currentJoint.y * currentJoint.z * this.globalBodyCurveIntensity.y
    
      positionAttribute.setXYZ(
        i,
        v.x + (jx * this.globalBodyCurveTension.x) * (1 - length), 
        v.y + (jy * this.globalBodyCurveTension.y) * (1 - length),
        v.z,
      )
    }

    positionAttribute.needsUpdate = true
    this.mesh.geometry.computeVertexNormals()
  }
}

class OrcaFun {  
  constructor() {
    this.assets = [
      { 
        name: 'orca',
        path: 'models/orca.glb',
        type: 'gltf'
      },
    
      { 
        name: 'sea', 
        path: 'textures/sea.png',
        type: 'texture' 
      }
    ]
  
    this.textureLoader = new Three.TextureLoader()
    this.gltfLoader = new GLTFLoader()
    
    this.textures = {}
    this.gltfs = {}
    
    this.renderer = new Three.WebGLRenderer({ antialias: true })
    this.scene = new Three.Scene()
    this.camera = new Three.PerspectiveCamera(
      12,
      window.innerWidth / window.innerHeight,
      1,
      300,
    )
    
    this.ambientLight = new Three.AmbientLight(0xffffff, 5)
    this.directionalLight = new Three.DirectionalLight(0xeeffff, 5)
    this.pointLight = new Three.PointLight(0xffffff, 100, 40)

    this.orca = new Orca(this)

    this._previousMousePosition = new Three.Vector3()
    this.mousePosition = new Three.Vector3()

    this.elapsed = 0
  }

  fun() {
    this.load()
      .then(data => {
        this.setupEventListeners()
        this.init()
        this.loop()
      })
      .catch(error => console.error(error))
  }

  load() {
    let self = this
    
    let promises = self.assets.map(({name, path, type}) => {
      switch(type) {
        case 'gltf': {
          if (self.gltfLoader.loadAsync)
            return self.gltfLoader.loadAsync(path).then(data => self.gltfs[name] = data)
          else
              return new Promise((resolve, reject) => {
                self.loader.load(
                  path,
                  data => {
                    self.gltfs[name] = data
                    resolve(data)
                  },
                  null,
                  reject
                )
              })
          break;
        }

        case 'texture': {
          return self.textureLoader.loadAsync(path).then(data => self.textures[name] = data)
          break;
        }

        default:
          console.warn(`Uknown asset ${name} of type: ${type}`)
          break;
      }
    })
                                        
    return Promise.all(promises)
  }

  setupEventListeners() {
    window.addEventListener("mousemove", e => this.onMouseMove(e))
    window.addEventListener("resize", e => this.onWindowResize(e))
  }

  dispatchInitialMouseMoveEvent() {
    let evt = new MouseEvent("mousemove", {
      clientX: window.innerWidth/2,
      clientY: window.innerHeight/2
    })

    window.dispatchEvent(evt);
  }

  init() {
    this.renderer.setSize(window.innerWidth, window.innerHeight)
    this.renderer.setClearColor(0xffffff, 1)
    this.renderer.toneMapping = Three.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 0.9
    document.body.appendChild(this.renderer.domElement)
    
    this.textures.sea.mapping = Three.EquirectangularReflectionMapping
    this.scene.environment = this.textures.sea
    
    this.camera.position.z = 9

    this.directionalLight.position.set(0, 0, 2)
    this.pointLight.position.set(1, 2, 1)

    //We need this ugly order of calls since the mouse movement function
    this.dispatchInitialMouseMoveEvent();
    this.orca.init(this.gltfs.orca.scene.children[0])

    this.scene.add(
      this.camera,
      this.orca.mesh,
      this.ambientLight, 
      this.directionalLight, 
      this.pointLight
    )
  }

  update() {

    this.orca.update(this.elapsed)

    this.elapsed++
  }

  render(time) {
    this.renderer.render(this.scene, this.camera)
  }
  
  loop() {
    this.update()
    this.render()
    requestAnimationFrame(_ => this.loop())
  }
  
  onMouseMove(e) {
    this.mousePosition
      .set(
        +(e.clientX / window.innerWidth ) * 2 - 1,
        -(e.clientY / window.innerHeight) * 2 + 1  
      )
      .unproject(this.camera)
      .sub(this.camera.position)
      .multiplyScalar(this.camera.position.z/-this.mousePosition.z)
  }

  onWindowResize(e) {
    this.camera.aspect = window.innerWidth / window.innerHeight
    this.camera.updateProjectionMatrix()
    this.renderer.setSize(window.innerWidth, window.innerHeight)
  }
}

const orca = new OrcaFun()
orca.fun()
