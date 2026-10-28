import * as THREE from 'three';

/** Fast diffuse-transmission approximation for white printed plastic. This
 * integrates a small LED patch; it is not ray tracing or calibrated photometry. */
export function createLampMaterial() {
 const uniforms={lampPosition:{value:new THREE.Vector3()},lampColor:{value:new THREE.Color('#ffd4a0')},lampPower:{value:1},lampTransmission:{value:.65}};
 const material=new THREE.MeshStandardMaterial({color:'#fff8ed',roughness:.68,metalness:0,side:THREE.DoubleSide});
 material.onBeforeCompile=shader=>{
  Object.assign(shader.uniforms,uniforms);
  shader.vertexShader='attribute float lampShell; varying float vLampShell; varying vec3 vLampPosition; varying vec3 vLampNormal;\n'+shader.vertexShader;
  shader.vertexShader=shader.vertexShader.replace('#include <worldpos_vertex>',`#include <worldpos_vertex>
   vLampShell=lampShell; vLampPosition=(modelMatrix*vec4(transformed,1.0)).xyz;
   vLampNormal=normalize(mat3(modelMatrix)*objectNormal);`);
  shader.fragmentShader=`varying float vLampShell; varying vec3 vLampPosition; varying vec3 vLampNormal;
   uniform vec3 lampPosition; uniform vec3 lampColor; uniform float lampPower; uniform float lampTransmission;
   float lampIrradiance(vec3 emitter) {
    vec3 delta=emitter-vLampPosition; float d2=dot(delta,delta); vec3 lightDir=delta*inversesqrt(max(d2,0.01));
    float incidence=abs(dot(normalize(vLampNormal),lightDir));
    // Up-facing LED patch, with a broad soft emission lobe.
    float emission=mix(0.12,1.0,smoothstep(-0.2,0.6,-lightDir.z));
    float opticalDepth=0.4/max(0.28,incidence);
    float scattering=exp(-opticalDepth/mix(0.12,2.8,lampTransmission));
    return 12500.0/(d2+500.0)*emission*(0.25+0.75*incidence)*scattering;
   }
  `+shader.fragmentShader;
  shader.fragmentShader=shader.fragmentShader.replace('#include <opaque_fragment>',`
   float transmitted=0.4*lampIrradiance(lampPosition)
    +0.15*(lampIrradiance(lampPosition+vec3(4.,0.,0.))+lampIrradiance(lampPosition-vec3(4.,0.,0.))
    +lampIrradiance(lampPosition+vec3(0.,4.,0.))+lampIrradiance(lampPosition-vec3(0.,4.,0.)));
   outgoingLight+=vLampShell*lampColor*lampPower*transmitted*lampTransmission;
   #include <opaque_fragment>`);
 };
 material.customProgramCacheKey=()=> 'contour-lamp-diffuse-v1';
 return {material,uniforms};
}

export function lampColor(kelvin:number) {
 const t=Math.max(1800,Math.min(6500,kelvin))/100;
 const clamp=(x:number)=>Math.max(0,Math.min(255,x))/255;
 return new THREE.Color().setRGB(clamp(t<=66?255:329.698727446*(t-60)**-.1332047592),clamp(t<=66?99.4708025861*Math.log(t)-161.1195681661:288.1221695283*(t-60)**-.0755148492),clamp(t>=66?255:t<=19?0:138.5177312231*Math.log(t-10)-305.0447927307),THREE.SRGBColorSpace);
}
