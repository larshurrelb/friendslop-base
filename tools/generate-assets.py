"""Original rounded worker, authored in Blender. Run with Blender --background --python."""
import bpy, bmesh, math
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
def material(name,color,roughness=.85):
    m=bpy.data.materials.new(name);m.diffuse_color=(*color,1);m.use_nodes=True
    bs=m.node_tree.nodes.get('Principled BSDF');bs.inputs['Base Color'].default_value=(*color,1);bs.inputs['Roughness'].default_value=roughness
    return m
cloth=material('Jacket / tintable',(.56,.29,.17));dark=material('Charcoal',(.13,.19,.18));skin=material('Warm clay',(.80,.68,.48));cream=material('Canvas',(.85,.79,.62));black=material('Eyes',(.035,.05,.04),.35);green=material('Sage cap',(.31,.43,.35));maw=material('Mouth',(.22,.09,.11),.6)
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
 o.name=name;o.data.materials.append(skin);o.data.materials.append(maw)
 group=o.vertex_groups.new(name=bone);group.add(list(range(len(o.data.vertices))),1,'REPLACE')
 mod=o.modifiers.new('Rig','ARMATURE');mod.object=rig;o.parent=rig
 return o
def panel(name,p,size,mat,bone,bevel=.015):
 bpy.ops.mesh.primitive_cube_add(size=1,location=p);o=bpy.context.object;o.dimensions=size
 bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
 mod=o.modifiers.new('Soft tailored edges','BEVEL');mod.width=bevel;mod.segments=4
 bpy.context.view_layer.objects.active=o;bpy.ops.object.modifier_apply(modifier=mod.name)
 return finish(o,name,size,mat,bone)
def seam(name,points,mat,bone,radius=.003):
 curve=bpy.data.curves.new(name,'CURVE');curve.dimensions='3D';curve.bevel_depth=radius;curve.bevel_resolution=2
 line=curve.splines.new('POLY');line.points.add(len(points)-1)
 for v,p in zip(line.points,points):v.co=(*p,1)
 o=bpy.data.objects.new(name,curve);bpy.context.collection.objects.link(o)
 bpy.ops.object.select_all(action='DESELECT');o.select_set(True);bpy.context.view_layer.objects.active=o;bpy.ops.object.convert(target='MESH')
 o=bpy.context.object;o.data.materials.append(mat);group=o.vertex_groups.new(name=bone);group.add(list(range(len(o.data.vertices))),1,'REPLACE')
 mod=o.modifiers.new('Rig','ARMATURE');mod.object=rig;o.parent=rig
 return o
# Soft workwear: a tailored barrel torso, round shoulders, ribbed cuffs, real pocket and zip.
# One continuous tailored surface avoids visible intersections across the shoulders.
profile=[(.775,.205,.14),(.80,.24,.166),(.86,.255,.181),(1.04,.264,.188),(1.20,.273,.177),(1.265,.263,.16),(1.315,.16,.119),(1.34,.11,.10)]
vertices=[(rx*math.cos(i/32*2*math.pi),ry*math.sin(i/32*2*math.pi),z) for z,rx,ry in profile for i in range(32)]
faces=[]
for j in range(len(profile)-1):
 for i in range(32):faces.append((j*32+i,j*32+(i+1)%32,(j+1)*32+(i+1)%32,(j+1)*32+i))
faces += [tuple(reversed(range(32))),tuple((len(profile)-1)*32+i for i in range(32))]
mesh=bpy.data.meshes.new('Tailored jacket');mesh.from_pydata(vertices,[],faces);mesh.update()
o=bpy.data.objects.new('Jacket',mesh);bpy.context.collection.objects.link(o)
o.data.materials.append(cloth)
for f in o.data.polygons:f.use_smooth=True
group=o.vertex_groups.new(name='spine');group.add(list(range(len(o.data.vertices))),1,'REPLACE')
mod=o.modifiers.new('Rig','ARMATURE');mod.object=rig;o.parent=rig
ball('Pants',(0,.005,.78),(.43,.32,.31),dark,'hips',rings=12)
ball('Neck',(0,0,1.34),(.19,.19,.17),skin,'head',segments=16,rings=10)
column('Collar',(0,0,1.32),(.255,.245,.10),cloth,'spine',taper=1.02,round_ends=.2)
column('Jacket hem',(0,0,.797),(.475,.331,.035),cloth,'spine',verts=32,round_ends=.2)
for sign,label in [(1,'L'),(-1,'R')]:
 column('Thigh.'+label,(sign*.13,0,.595),(.205,.225,.37),dark,'leg'+label,taper=1.04,verts=24,round_ends=.4)
 ball('Knee.'+label,(sign*.13,0,.425),(.198,.214,.19),dark,'shin'+label)
 column('Trouser.'+label,(sign*.13,0,.28),(.18,.195,.33),dark,'shin'+label,taper=1.08,verts=24,round_ends=.4)
 column('Trouser cuff.'+label,(sign*.13,0,.145),(.181,.195,.055),dark,'shin'+label,round_ends=.3)
 ball('Boot.'+label,(sign*.13,-.058,.105),(.22,.35,.20),green,'foot'+label,segments=24,rings=14)
 ball('Sole.'+label,(sign*.13,-.058,.043),(.224,.352,.073),dark,'foot'+label,segments=24,rings=10)
 ball('Upper sleeve.'+label,(sign*.31,0,1.155),(.19,.205,.32),cloth,'arm'+label)
 ball('Elbow.'+label,(sign*.31,0,1.005),(.174,.188,.17),cloth,'forearm'+label)
 column('Lower sleeve.'+label,(sign*.31,0,.915),(.165,.18,.26),cloth,'forearm'+label,taper=1.12,verts=24,round_ends=.42)
 column('Cuff.'+label,(sign*.31,0,.798),(.169,.181,.06),cloth,'forearm'+label,round_ends=.3)
 ball('Mitten.'+label,(sign*.31,-.018,.707),(.15,.165,.205),skin,'forearm'+label)
 ball('Thumb.'+label,(sign*.256,-.072,.726),(.068,.088,.108),skin,'forearm'+label,segments=16,rings=10)
head_half('Cranium',True,'jaw');head_half('Jawbowl',False,'head')
# Rounded flat cap, short curved visor, band and original stitched crown seams.
ball('Cap crown',(0,.008,1.758),(.61,.562,.255),green,'jaw',segments=32,rings=16)
column('Cap band',(0,-.002,1.711),(.595,.536,.059),green,'jaw',verts=32,round_ends=.35)
ball('Cap visor',(0,-.242,1.698),(.55,.36,.052),green,'jaw',segments=28,rings=10,tilt=-.055)
for side in [-1,1]:
 points=[]
 for i in range(21):
  t=-1.1+i/20*2.2
  x=side*.16*math.cos(t);y=.268*math.sin(t)
  z=.1275*math.sqrt(max(0,1-(x/.305)**2-(y/.281)**2))
  points.append((x,.008+y,1.758+z+.001))
 seam('Cap seam',points,green,'jaw',.0028)
for x in [-.112,.112]:
 ball('Eye',(x,-.248,1.577),(.066,.043,.078),black,'jaw',segments=20,rings=12)
 ball('Eye glint',(x-.011,-.269,1.594),(.009,.006,.010),cream,'jaw',segments=10,rings=6)
panel('Pocket',(.125,-.186,1.036),(.157,.024,.151),cloth,'spine',.021)
panel('Pocket welt',(.125,-.204,1.096),(.163,.018,.019),cloth,'spine',.006)
panel('Zip tape',(0,-.177,1.063),(.025,.014,.446),green,'spine',.004)
for i in range(21):panel('Zip teeth',(0,-.187,.855+i*.018),(.013,.007,.006),dark,'spine',.002)
panel('Zip pull',(0,-.192,1.233),(.019,.012,.035),dark,'spine',.005)
seam('Pocket stitching',[(.057,-.201,1.085),(.057,-.201,.973),(.065,-.201,.966),(.188,-.201,.966),(.194,-.201,.973),(.194,-.201,1.085)],cloth,'spine',.002)
# Explicit actions exported as glTF animation clips. The head and jaw are left unkeyed
# so the runtime can aim them from look-pitch and voice loudness.
DRIVEN={'head','jaw'}
rig.animation_data_create()
for name in ['Idle','Walk','Sprint','Crouch','Jump','Hold']:
 action=bpy.data.actions.new(name);rig.animation_data.action=action
 for frame in [1,7,13,19,25]:
  phase=(frame-1)/24*2*math.pi
  for bone in rig.pose.bones:
   bone.rotation_mode='XYZ';bone.rotation_euler=(0,0,0);bone.location=(0,0,0)
  if name in ['Walk','Sprint','Crouch']:
   amount=.65 if name=='Sprint' else .38 if name=='Walk' else .12
   for label,sign in [('L',1),('R',-1)]:
    swing=math.sin(phase)*amount*sign
    rig.pose.bones['leg'+label].rotation_euler.x=swing
    rig.pose.bones['shin'+label].rotation_euler.x=max(0,-math.sin(phase)*sign)*amount*.65
    rig.pose.bones['arm'+label].rotation_euler.x=-swing*.7
    rig.pose.bones['forearm'+label].rotation_euler.x=-.1
   if name=='Crouch':
    rig.pose.bones['hips'].location.y=-.327
    rig.pose.bones['spine'].rotation_euler.x=-.12
    for label,sign in [('L',1),('R',-1)]:
     swing=math.sin(phase)*amount*sign
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
