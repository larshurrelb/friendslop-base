"""Original rounded worker, authored in Blender. Run with Blender --background --python."""
import bpy, bmesh, math
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
def material(name,color,roughness=.55):
    m=bpy.data.materials.new(name);m.diffuse_color=(*color,1);m.use_nodes=True
    bs=m.node_tree.nodes.get('Principled BSDF');bs.inputs['Base Color'].default_value=(*color,1);bs.inputs['Roughness'].default_value=roughness
    return m
cloth=material('Jacket / tintable',(.18,.88,.10));nose=material('Nose / tintable',(.42,.98,.35));maw=material('Mouth / tintable',(.95,.05,.45),.5);eye_white=material('EyeWhite',(.98,.98,.98),.25);eye_pupil=material('EyePupil',(.02,.02,.02),.15)
# Head geometry, shared by the rig and the two halves it splits into.
HEAD=(0,-.015,1.53);HEAD_SIZE=(.58,.52,.55);JAW_LINE=1.47;HINGE=(0,.20,JAW_LINE)
bpy.ops.object.armature_add();rig=bpy.context.object;rig.name='CommonRoomRig';bpy.ops.object.mode_set(mode='EDIT');rig.data.edit_bones.remove(rig.data.edit_bones[0])
bones={
 'hips':((0,0,.76),(0,0,.93),None),'spine':((0,0,.93),(0,0,1.32),'hips'),'head':((0,0,1.32),(0,0,JAW_LINE),'spine'),
 'jaw':(HINGE,(HINGE[0],HINGE[1],1.82),'head'),
 'armL':((.31,0,1.27),(.31,0,1.00),'spine'),'armR':((-.31,0,1.27),(-.31,0,1.00),'spine'),
 'forearmL':((.31,0,1.00),(.31,0,.76),'armL'),'forearmR':((-.31,0,1.00),(-.31,0,.76),'armR'),
 'legL':((.13,0,.76),(.13,0,.42),'hips'),'legR':((-.13,0,.76),(-.13,0,.42),'hips'),
 'shinL':((.13,0,.42),(.13,0,.11),'legL'),'shinR':((-.13,0,.42),(-.13,0,.11),'legR'),
 'footL':((.13,0,.11),(.13,-.18,.11),'shinL'),'footR':((-.13,0,.11),(-.13,-.18,.11),'shinR')}

for name,(h,t,parent) in bones.items():
 b=rig.data.edit_bones.new(name);b.head=h;b.tail=t
 if parent:b.parent=rig.data.edit_bones[parent]
bpy.ops.object.mode_set(mode='OBJECT')
def finish(o,name,size,mat,bone,tilt=0):
 o.name=name;o.dimensions=size;bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
 if tilt:
  o.rotation_euler=(tilt,0,0);bpy.ops.object.transform_apply(location=False,rotation=True,scale=False)
 for f in o.data.polygons:f.use_smooth=True
 o.data.materials.append(mat);group=o.vertex_groups.new(name=bone);group.add(list(range(len(o.data.vertices))),1,'REPLACE')
 mod=o.modifiers.new('Rig','ARMATURE');mod.object=rig;o.parent=rig
 return o
def ball(name,p,size,mat,bone,segments=20,rings=12,tilt=0):
 bpy.ops.mesh.primitive_uv_sphere_add(segments=segments,ring_count=rings,radius=.5,location=p)
 return finish(bpy.context.object,name,size,mat,bone,tilt)
def column(name,p,size,mat,bone,taper=1.,verts=18,round_ends=.68):
 """A tapered barrel whose rims are rounded off, so every silhouette edge reads as a curve."""
 bpy.ops.mesh.primitive_cone_add(vertices=verts,radius1=.5,radius2=.5*taper,depth=1,location=p);o=bpy.context.object
 mod=o.modifiers.new('Rounded ends','BEVEL');mod.width=.5*min(1,taper)*round_ends;mod.segments=6;mod.limit_method='ANGLE';mod.angle_limit=math.radians(30)
 bpy.context.view_layer.objects.active=o;bpy.ops.object.modifier_apply(modifier=mod.name)
 return finish(o,name,size,mat,bone)
def head_half(name,upper,bone):
 """One half of the skull, capped with a flat disc of mouth material at the cut."""
 bpy.ops.mesh.primitive_uv_sphere_add(segments=28,ring_count=16,radius=.5,location=HEAD)
 o=bpy.context.object;o.dimensions=HEAD_SIZE;bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
 bm=bmesh.new();bm.from_mesh(o.data)
 cut=bmesh.ops.bisect_plane(bm,geom=bm.verts[:]+bm.edges[:]+bm.faces[:],dist=1e-5,plane_co=(0,0,JAW_LINE-HEAD[2]),plane_no=(0,0,1),clear_inner=upper,clear_outer=not upper)
 for f in bm.faces:f.smooth=True
 rim=[e for e in cut['geom_cut'] if isinstance(e,bmesh.types.BMEdge)]
 for f in bmesh.ops.holes_fill(bm,edges=rim,sides=0)['faces']:f.smooth=False;f.material_index=1
 bm.to_mesh(o.data);bm.free();o.data.update()
 o.name=name;o.data.materials.append(cloth);o.data.materials.append(maw)
 group=o.vertex_groups.new(name=bone);group.add(list(range(len(o.data.vertices))),1,'REPLACE')
 mod=o.modifiers.new('Rig','ARMATURE');mod.object=rig;o.parent=rig
 return o
# Puppet creature body: smooth pear-shaped torso without clothes.
profile=[(.76,.23,.17),(.82,.255,.185),(.92,.27,.195),(1.05,.27,.19),(1.17,.25,.175),(1.25,.22,.155),(1.31,.16,.125),(1.35,.115,.105)]
vertices=[(rx*math.cos(i/32*2*math.pi),ry*math.sin(i/32*2*math.pi),z) for z,rx,ry in profile for i in range(32)]
faces=[]
for j in range(len(profile)-1):
 for i in range(32):faces.append((j*32+i,j*32+(i+1)%32,(j+1)*32+(i+1)%32,(j+1)*32+i))
faces += [tuple(reversed(range(32))),tuple((len(profile)-1)*32+i for i in range(32))]
mesh=bpy.data.meshes.new('Puppet body');mesh.from_pydata(vertices,[],faces);mesh.update()
o=bpy.data.objects.new('Body',mesh);bpy.context.collection.objects.link(o)
o.data.materials.append(cloth)
for f in o.data.polygons:f.use_smooth=True
group=o.vertex_groups.new(name='spine');group.add(list(range(len(o.data.vertices))),1,'REPLACE')
mod=o.modifiers.new('Rig','ARMATURE');mod.object=rig;o.parent=rig
ball('Pelvis',(0,.005,.78),(.45,.35,.33),cloth,'hips',rings=14)
ball('Neck',(0,0,1.34),(.22,.22,.18),cloth,'head',segments=18,rings=10)
# Head halves: Cranium hinges open on jaw, Jawbowl sits on head
head_half('Cranium',True,'jaw');head_half('Jawbowl',False,'head')
# Googly cartoon eyes and plump oval nose on the upper head (weighted to jaw so they lift when mouth opens)
for sign,label in [(1,'L'),(-1,'R')]:
 ball('Eyeball.'+label,(sign*.12,-.235,1.575),(.13,.12,.13),eye_white,'jaw',segments=20,rings=12)
 ball('Pupil.'+label,(sign*.10,-.292,1.575),(.055,.04,.055),eye_pupil,'jaw',segments=14,rings=8)
ball('Nose',(0,-.275,1.53),(.11,.12,.15),nose,'jaw',segments=20,rings=12)
# Arms and hands: rounded shoulders, articulated arms, palm, thumb and 3 fingers
for sign,label in [(1,'L'),(-1,'R')]:
 ball('Shoulder.'+label,(sign*.28,0,1.22),(.15,.15,.15),cloth,'arm'+label,segments=16,rings=10)
 column('Upper arm.'+label,(sign*.285,0,1.11),(.13,.13,.24),cloth,'arm'+label,taper=.95,verts=18,round_ends=.4)
 ball('Elbow.'+label,(sign*.29,0,1.00),(.13,.13,.13),cloth,'forearm'+label,segments=16,rings=10)
 column('Forearm.'+label,(sign*.29,0,.88),(.12,.12,.22),cloth,'forearm'+label,taper=.92,verts=18,round_ends=.4)
 ball('Palm.'+label,(sign*.29,-.015,.74),(.12,.13,.12),cloth,'forearm'+label,segments=16,rings=10)
 ball('Thumb.'+label,(sign*.235,-.045,.745),(.06,.075,.085),cloth,'forearm'+label,segments=12,rings=8)
 ball('Finger1.'+label,(sign*.26,-.02,.66),(.045,.05,.09),cloth,'forearm'+label,segments=12,rings=8)
 ball('Finger2.'+label,(sign*.29,-.02,.65),(.046,.05,.10),cloth,'forearm'+label,segments=12,rings=8)
 ball('Finger3.'+label,(sign*.32,-.02,.66),(.045,.05,.09),cloth,'forearm'+label,segments=12,rings=8)
# Legs and feet: creature legs with rounded foot and 3 cute puppet toes
for sign,label in [(1,'L'),(-1,'R')]:
 column('Thigh.'+label,(sign*.13,0,.59),(.17,.18,.35),cloth,'leg'+label,taper=.96,verts=20,round_ends=.4)
 ball('Knee.'+label,(sign*.13,0,.42),(.16,.17,.16),cloth,'shin'+label,segments=16,rings=10)
 column('Shin.'+label,(sign*.13,0,.27),(.15,.16,.31),cloth,'shin'+label,taper=.9,verts=20,round_ends=.4)
 ball('Foot.'+label,(sign*.13,-.05,.08),(.18,.25,.13),cloth,'foot'+label,segments=20,rings=12)
 ball('Toe1.'+label,(sign*.075,-.17,.06),(.065,.09,.07),cloth,'foot'+label,segments=14,rings=8)
 ball('Toe2.'+label,(sign*.13,-.185,.06),(.068,.095,.07),cloth,'foot'+label,segments=14,rings=8)
 ball('Toe3.'+label,(sign*.185,-.17,.06),(.062,.085,.07),cloth,'foot'+label,segments=14,rings=8)
# Explicit actions exported as glTF animation clips. The head and jaw are left unkeyed
# so the runtime can aim them from look-pitch and voice loudness. Locomotion uses nine
# poses per loop: the extra passing/up poses, bent swing knee, ankle roll, body rise and
# torso counter-motion keep the short puppet limbs from reading as rigid pendulums.
DRIVEN={'head','jaw'}
rig.animation_data_create()
for name in ['Idle','Walk','Sprint','Crouch','Jump','Hold']:
 action=bpy.data.actions.new(name);rig.animation_data.action=action
 for frame in [1,4,7,10,13,16,19,22,25]:
  phase=(frame-1)/24*2*math.pi
  for bone in rig.pose.bones:
   bone.rotation_mode='XYZ';bone.rotation_euler=(0,0,0);bone.location=(0,0,0)
  if name in ['Walk','Sprint','Crouch']:
   amount=.72 if name=='Sprint' else .46 if name=='Walk' else .16
   bounce=.035 if name=='Sprint' else .022 if name=='Walk' else .012
   rig.pose.bones['hips'].location.y=-math.cos(phase*2)*bounce
   rig.pose.bones['hips'].location.x=math.cos(phase)*(.018 if name=='Sprint' else .012)
   rig.pose.bones['hips'].rotation_euler.z=-math.sin(phase)*(.055 if name=='Sprint' else .035)
   rig.pose.bones['spine'].rotation_euler.y=math.cos(phase)*(.035 if name=='Sprint' else .022)
   rig.pose.bones['spine'].rotation_euler.z=math.sin(phase)*(.075 if name=='Sprint' else .045)
   for label,sign in [('L',1),('R',-1)]:
    swing=math.cos(phase)*amount*sign
    lift=max(0,-math.sin(phase)*sign)
    push=max(0,math.sin(phase)*sign)
    rig.pose.bones['leg'+label].rotation_euler.x=swing
    rig.pose.bones['shin'+label].rotation_euler.x=lift*amount*.9+.06
    rig.pose.bones['foot'+label].rotation_euler.x=-swing*.32-lift*amount*.28+push*amount*.18
    rig.pose.bones['arm'+label].rotation_euler.x=-swing*.72
    rig.pose.bones['arm'+label].rotation_euler.z=-sign*.045
    rig.pose.bones['forearm'+label].rotation_euler.x=-.16-lift*.20
   if name=='Crouch':
    rig.pose.bones['hips'].location.y=-.327-math.cos(phase*2)*bounce
    rig.pose.bones['spine'].rotation_euler.x=-.12
    for label,sign in [('L',1),('R',-1)]:
     swing=math.cos(phase)*amount*sign
     rig.pose.bones['leg'+label].rotation_euler.x=-1.04+swing
     rig.pose.bones['shin'+label].rotation_euler.x=2.08-swing*.5
     rig.pose.bones['foot'+label].rotation_euler.x=1.04+swing*.5
     rig.pose.bones['arm'+label].rotation_euler.x=-.25-swing*.5
     rig.pose.bones['forearm'+label].rotation_euler.x=-.4
  if name=='Idle':rig.pose.bones['spine'].rotation_euler.y=math.sin(phase)*.015
  if name=='Jump':
   rig.pose.bones['legL'].rotation_euler.x=.3;rig.pose.bones['legR'].rotation_euler.x=-.2
  if name=='Hold':
   rig.pose.bones['armL'].rotation_euler.x=-1.1;rig.pose.bones['armR'].rotation_euler.x=-1.1
  for bone in rig.pose.bones:
   if bone.name not in DRIVEN:
    bone.keyframe_insert('rotation_euler',frame=frame);bone.keyframe_insert('location',frame=frame)
 action.use_fake_user=True
rig.animation_data.action=None
for bone in rig.pose.bones:bone.rotation_euler=(0,0,0);bone.location=(0,0,0)
bpy.context.scene.frame_start=1;bpy.context.scene.frame_end=25
# Merge rigidly weighted pieces to reduce draw calls; preserve the armature and material groups.
bpy.ops.object.select_all(action='DESELECT')
meshes=[o for o in bpy.context.scene.objects if o.type=='MESH']
for o in meshes:o.select_set(True)
bpy.context.view_layer.objects.active=meshes[0]
bpy.ops.object.join()
bpy.context.object.name='CommonWorkerMesh'
bpy.ops.object.select_all(action='SELECT')
# Blender persists the last directory from every file-browser area in the .blend.
# Clear it so the committed source never contains the generating user's home path.
for screen in bpy.data.screens:
 for area in screen.areas:
  for space in area.spaces:
   if space.type=='FILE_BROWSER':space.params.directory=b'/tmp/friendslop-base/generated-assets'
(ROOT/'assets-source/blender').mkdir(parents=True,exist_ok=True)
bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'assets-source/blender/common-worker.blend'))
bpy.ops.export_scene.gltf(filepath=str(ROOT/'public/models/common-worker.glb'),export_format='GLB',use_selection=True,export_animations=True,export_animation_mode='ACTIONS')
print('Generated original rounded humanoid with a hinged mouth and six animation clips.')
