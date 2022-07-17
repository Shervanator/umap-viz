import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { CSS2DRenderer, CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer';
import { OrbitControls } from './OrbitControls';
import { SpatialControls } from "spatial-controls"
import { BloomEffect, EffectComposer, EffectPass, RenderPass } from "postprocessing";
import './viz.css'

const CLICK_HOST = "https://localhost"


function Viz() {
  const divRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.0001, 1000000);
    camera.position.z = 1;

    camera.lookAt(0, 0, 0)

    const scene = new THREE.Scene();

    function onWindowResize(){      
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      
      renderer.setSize(window.innerWidth, window.innerHeight);
      labelRenderer.setSize(window.innerWidth, window.innerHeight);
    }

    window.addEventListener( 'resize', onWindowResize, false );

    const colorArray = [
      [292, 60, 136],
      [244, 193, 125],
      [198, 227, 169],
      [92, 80, 157],
    ]

    const vertexShader = `
      attribute vec3 customColor;
      attribute float randomNumber;
      
      varying vec3 vColor;
      varying float vrandomNumber;

      uniform float time;

      void main() {
        vColor = customColor;
        vrandomNumber = randomNumber;

        vec4 cs_position = modelViewMatrix * vec4(position, 1.0);
        
        gl_PointSize = 1.5 + (2.5 / -cs_position.z);
        gl_Position = projectionMatrix * cs_position;
      }`
    
    const fragmentShader = `
      varying vec3 vColor;
      varying float vrandomNumber;

      uniform float time;

      void main() {
        gl_FragColor = (((sin((vrandomNumber * 50.0) + (time * 3.0)) + 1.0) / (2.0)) + 0.8) * vec4(vColor, 1.0);
        // gl_FragColor = (((sin(time * 10.0) + 1.0) / (18.0)) + 1.0) * vec4(vColor, 1.0);
        // gl_FragColor = (((sin((vrandomNumber * 10.0) + (time * 10.0)) + 1.0) / (1.0)) + 1.0) * vec4(vColor, 1.0);
      }`

    const material = new THREE.ShaderMaterial({
      uniforms: {
        time: { value: 0.0 },
      },
      vertexShader: vertexShader,
      fragmentShader: fragmentShader,
    })

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();

    function onPointerMove(event: PointerEvent) {
      pointer.x = ( event.clientX / window.innerWidth ) * 2 - 1;
      pointer.y = - ( event.clientY / window.innerHeight ) * 2 + 1;
    }

    let embeddings: [number, number, number][]
    let categories: number[]
    let labels: string[]

    window.addEventListener('pointermove', onPointerMove)

    async function loadMesh() {
      // const request = await fetch(`./embeddings.json`)
      // embeddings = await request.json() as [number, number, number][]

      // const request2 = await fetch(`./embeddings-category.json`)
      // categories = await request2.json() as number[]

      // const request3 = await fetch(`./embeddings-labels.json`)
      // labels = await request3.json() as string[]
      embeddings = require('./embeddings.json')
      categories = require('./embeddings-category.json')
      // labels = require('./embeddings-labels.json')
      labels = categories.map(() => 'REDACTED')

      const geometry = new THREE.BufferGeometry()
      
      const positions = new Float32Array(embeddings.length * 3)
      const colors = new Float32Array(embeddings.length * 3);
      const randomNumbers = new Float32Array(embeddings.length);

      geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
      geometry.setAttribute('customColor', new THREE.BufferAttribute(colors, 3));
      geometry.setAttribute('randomNumber', new THREE.BufferAttribute(randomNumbers, 1));

      const color = new THREE.Color( 0xffffff );

      for (let i = 0; i < embeddings.length; i++) {
        const embedding = embeddings[i]
        
        positions[(i * 3)] = embedding[0]
        positions[(i * 3) + 1] = embedding[1]
        positions[(i * 3) + 2] = embedding[2]

        const colorVal = colorArray[categories[i] - 1]
        color.setRGB(colorVal[0] / 255.0, colorVal[1] / 255.0, colorVal[2] / 255.0)
        color.toArray( colors, i * 3 );

        randomNumbers[i] = Math.random()
      }
      const pointCloud = new THREE.Points(geometry, material)

      scene.add(pointCloud);
    }

    loadMesh()

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);

    const composer = new EffectComposer(renderer);
    
    composer.addPass(new RenderPass(scene, camera));
    composer.addPass(new EffectPass(camera, new BloomEffect({
      intensity: 2.0,
      luminanceThreshold: 0.25,
    })));

    let controls: OrbitControls | SpatialControls

    if( /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) ) {
      controls = new OrbitControls( camera, renderer.domElement );
    } else {
      const { position, quaternion } = camera;
      controls = new SpatialControls(position, quaternion, renderer.domElement);
      const settings = controls.settings;
      settings.translation.setSensitivity(10)
      settings.rotation.setSensitivity(10)
    }

    const labelRenderer = new CSS2DRenderer();
    labelRenderer.setSize( window.innerWidth, window.innerHeight );
    labelRenderer.domElement.style.position = 'absolute';
    labelRenderer.domElement.style.top = '0px';
    labelRenderer.domElement.style.pointerEvents = 'none';

    if (divRef.current) {
      divRef.current.innerHTML = '';
      divRef.current.appendChild(renderer.domElement);
      divRef.current.appendChild(labelRenderer.domElement);
    }


    const text = document.createElement('div');
    text.className = 'label';
    const label = new CSS2DObject(text);
    scene.add(label);

    let drag = false;
    let selectedNamespace = ''

    document.addEventListener('mousedown', () => drag = false);

    function onPointerDown() {
      drag = true;
      raycaster.setFromCamera(pointer, camera);
      const intersects = raycaster.intersectObjects( scene.children )

      let closestIntersect: THREE.Intersection<THREE.Object3D<THREE.Event>> | null = null
      let closestDistance: number = 1000000000000.0

      for (const intersect of intersects) {
        if (intersect.distanceToRay && intersect.distanceToRay < closestDistance) {
          closestDistance = intersect.distanceToRay
          closestIntersect = intersect
        }
      }

      if (closestIntersect?.index) {
        const namespace = labels[closestIntersect.index]
        const embedding = embeddings[closestIntersect.index]

        text.textContent = namespace;
        selectedNamespace = namespace;

        label.position.copy(new THREE.Vector3(embedding[0], embedding[1], embedding[2]));
      }
    }
    window.addEventListener('mousemove', onPointerDown)

    window.addEventListener('mouseup', () => {
      if (!drag) {
        // window.open(`${CLICK_HOST}${selectedNamespace}`, '_blank')?.focus();
      }
    })
    
    function render(time: number) {
      material.uniforms.time.value = time / 1000.0;
      controls.update(time);
      composer.render(time);
      labelRenderer.render(scene, camera);
    }

    renderer.setAnimationLoop(render);
  }, [])

  return (
    <div ref={divRef}/>
  );
}

export default Viz;
