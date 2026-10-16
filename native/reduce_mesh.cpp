#include <CGAL/Exact_predicates_inexact_constructions_kernel.h>
#include <CGAL/Surface_mesh.h>
#include <CGAL/Polygon_mesh_processing/connected_components.h>

#include <CGAL/Surface_mesh_simplification/edge_collapse.h>
#include <CGAL/Surface_mesh_simplification/Edge_collapse_visitor_base.h>
#include <CGAL/Surface_mesh_simplification/Policies/Edge_collapse/Count_stop_predicate.h>
#include <CGAL/Surface_mesh_simplification/Policies/Edge_collapse/Constrained_placement.h>
#include <CGAL/Surface_mesh_simplification/Policies/Edge_collapse/LindstromTurk_cost.h>
#include <CGAL/Surface_mesh_simplification/Policies/Edge_collapse/LindstromTurk_placement.h>
#include <CGAL/Surface_mesh_simplification/Policies/Edge_collapse/Bounded_normal_change_filter.h>
#include <CGAL/Surface_mesh_simplification/Policies/Edge_collapse/GarlandHeckbert_plane_policies.h>
#include <chrono>
#include <future>
#include <mutex>
#include <filesystem>
#include <fstream>
#include <unordered_map>
#include <array>
#include <cstring>
#include <iostream>
#include <iomanip>
#include <stdexcept>
#include <sys/resource.h>
using K=CGAL::Exact_predicates_inexact_constructions_kernel;
using Point=K::Point_3;
using Mesh=CGAL::Surface_mesh<Point>;
namespace SMS=CGAL::Surface_mesh_simplification;
namespace PMP=CGAL::Polygon_mesh_processing;
using Clock=std::chrono::steady_clock;
static auto start=Clock::now();
static double seconds(){return std::chrono::duration<double>(Clock::now()-start).count();}
static void log(const std::string& s){static std::mutex mutex;std::lock_guard<std::mutex> lock(mutex);std::cerr<<std::fixed<<std::setprecision(2)<<seconds()<<" s: "<<s<<std::endl;}
struct Key{std::array<float,3> p; bool operator==(const Key& b)const{return p==b.p;}};
struct Hash{size_t operator()(const Key& k)const{size_t h=0;for(float x:k.p)h^=std::hash<float>{}(x)+0x9e3779b9+(h<<6)+(h>>2);return h;}};
Mesh read_stl(const std::string& path){
 std::ifstream in(path,std::ios::binary);char header[80];uint32_t n=0;
 if(!in.read(header,80)||!in.read(reinterpret_cast<char*>(&n),4)||std::filesystem::file_size(path)!=84ull+50ull*n)throw std::runtime_error("Invalid binary STL length");
 Mesh mesh;mesh.reserve(n/2+2,3ull*n/2,n);std::unordered_map<Key,Mesh::Vertex_index,Hash> verts;verts.reserve(n/2+2);
 for(uint32_t i=0;i<n;i++){
  char row[50];if(!in.read(row,50))throw std::runtime_error("Truncated STL");std::array<Mesh::Vertex_index,3> vs;
  for(int j=0;j<3;j++){
   Key key;std::memcpy(key.p.data(),row+12+j*12,12);
   for(float x:key.p)if(!std::isfinite(x))throw std::runtime_error("Nonfinite STL vertex");
   auto pair=verts.emplace(key,Mesh::null_vertex());if(pair.second)pair.first->second=mesh.add_vertex(Point(key.p[0],key.p[1],key.p[2]));vs[j]=pair.first->second;
  }
  if(vs[0]==vs[1]||vs[1]==vs[2]||vs[2]==vs[0]||mesh.add_face(vs)==Mesh::null_face())throw std::runtime_error("STL has an open, nonmanifold or inconsistently wound junction at triangle "+std::to_string(i));
 }
 return mesh;
}
void write_stl(const Mesh& mesh,const std::string& path){
 std::ofstream out(path,std::ios::binary);char header[80]={};std::strcpy(header,"Contour Lab guarded simplification candidate");uint32_t n=mesh.number_of_faces();out.write(header,80);out.write(reinterpret_cast<char*>(&n),4);
 for(auto f:mesh.faces()){
  auto h=mesh.halfedge(f);Point ps[]={mesh.point(mesh.source(h)),mesh.point(mesh.target(h)),mesh.point(mesh.target(mesh.next(h)))};
  auto norm=CGAL::cross_product(ps[1]-ps[0],ps[2]-ps[0]);double len=std::sqrt(norm.squared_length());float vals[12];for(int j=0;j<3;j++)vals[j]=norm[j]/len;
  for(int i=0;i<3;i++)for(int j=0;j<3;j++)vals[3+3*i+j]=static_cast<float>(ps[i][j]);uint16_t attr=0;out.write(reinterpret_cast<char*>(vals),48);out.write(reinterpret_cast<char*>(&attr),2);
 }
 if(!out)throw std::runtime_error("Cannot write candidate STL");
}
struct Audit{std::vector<std::pair<long,bool>> shells;double volume=0;};
Audit validate(Mesh& mesh,bool check_intersections=true){
 if(mesh.is_empty()||!CGAL::is_valid_polygon_mesh(mesh)||!CGAL::is_closed(mesh)||!CGAL::is_triangle_mesh(mesh))throw std::runtime_error("Mesh is not a closed triangular manifold");
 for(auto f:mesh.faces()){
  auto h=mesh.halfedge(f);if(CGAL::cross_product(mesh.point(mesh.target(h))-mesh.point(mesh.source(h)),mesh.point(mesh.target(mesh.next(h)))-mesh.point(mesh.source(h))).squared_length()<1e-24)throw std::runtime_error("Collapsed triangle");
 }

 auto cc=mesh.add_property_map<Mesh::Face_index,size_t>("f:component",0).first;size_t count=PMP::connected_components(mesh,cc);
 std::vector<long> euler(count,0);std::vector<double> volume(count,0);
 for(auto f:mesh.faces()){
  size_t c=cc[f];euler[c]++;auto h=mesh.halfedge(f);auto a=mesh.point(mesh.source(h))-CGAL::ORIGIN,b=mesh.point(mesh.target(h))-CGAL::ORIGIN,d=mesh.point(mesh.target(mesh.next(h)))-CGAL::ORIGIN;
  volume[c]+=CGAL::to_double(a*CGAL::cross_product(b,d))/6.;
 }
 for(auto e:mesh.edges())euler[cc[mesh.face(mesh.halfedge(e))]]--;
 for(auto v:mesh.vertices())euler[cc[mesh.face(mesh.halfedge(v))]]++;
 Audit a;for(size_t i=0;i<count;i++){a.shells.push_back({euler[i],volume[i]>0});a.volume+=volume[i];}std::sort(a.shells.begin(),a.shells.end());mesh.remove_property_map(cc);
 if(a.volume<=0)throw std::runtime_error("Nonpositive oriented volume");return a;
}
// CGAL controls legal edge collapses; QEM ranks their geometric cost.
using Quadric=SMS::GarlandHeckbert_plane_policies<Mesh,K>;
struct FloatPlacement{
 const Quadric* policy=nullptr;
 template<class Profile> boost::optional<typename Profile::Point> operator()(const Profile& p)const{
  auto out=policy->get_placement()(p);
  if(out){auto q=*out;volatile float x=float(q.x()),y=float(q.y()),z=float(q.z());
   if(std::isfinite(x)&&std::isfinite(y)&&std::isfinite(z))return Point(double(x),double(y),double(z));}
  return boost::none;
 }
};
struct SafeNormalFilter {
 template<class Profile> boost::optional<typename Profile::Point> operator()(const Profile& p,boost::optional<typename Profile::Point> out)const{
  out=SMS::Bounded_normal_change_filter<>()(p,out);if(!out)return out;
  auto it=p.triangles().begin();if(p.left_face_exists())++it;if(p.right_face_exists())++it;
  for(;it!=p.triangles().end();++it){
   auto a=get(p.vertex_point_map(),it->v0),c=get(p.vertex_point_map(),it->v2);
   if(CGAL::cross_product(*out-a,c-a).squared_length()<1e-24)return boost::none;
  }
  return out;
 }
};
struct Progress:SMS::Edge_collapse_visitor_base<Mesh>{
 mutable double last=0;size_t done=0;
 void OnCollected(const Profile&,const boost::optional<FT>&){if(seconds()-last>15){log("Collecting candidate edges");last=seconds();}}
 void OnSelected(const Profile&,const boost::optional<FT>&,size_type initial,size_type current){if(seconds()-last>15){log("Simplifying: "+std::to_string(current)+" / "+std::to_string(initial)+" edges remain");last=seconds();}}
 void OnCollapsed(const Profile&,const vertex_descriptor&){done++;}
};
int main(int argc,char**argv){
 std::string tmp;
 try{
  if(argc!=4)throw std::runtime_error("Usage: reduce_mesh source.stl output.stl target_fraction");
  std::string src=argv[1],out=argv[2];double tol=std::stod(argv[3]);if(!(tol>0&&tol<=1))throw std::runtime_error("Target fraction must be >0 and <=1");
  if(std::filesystem::exists(out))throw std::runtime_error("Output exists; refusing overwrite");if(std::filesystem::exists(out+".candidate"))throw std::runtime_error("Candidate path already exists");tmp=out+".candidate";
  log("Reading and exactly welding source STL");Mesh mesh=read_stl(src);const size_t original=mesh.number_of_faces();log("Validating input: "+std::to_string(original)+" triangles");Audit before=validate(mesh,false);double imported=seconds();

  using Filter=SafeNormalFilter;
  double zmin=1e100,zmax=-1e100;for(auto v:mesh.vertices()){zmin=std::min(zmin,mesh.point(v).z());zmax=std::max(zmax,mesh.point(v).z());}
  const size_t section_size=std::getenv("SECTION_MAX_FACES") ? std::stoul(std::getenv("SECTION_MAX_FACES")) : 100000;
  if(section_size<100)throw std::runtime_error("SECTION_MAX_FACES must be at least 100");
  const size_t patches=std::max<size_t>(1,(original+section_size-1)/section_size);
  std::vector<std::vector<Mesh::Face_index>> bins(patches);
  // Equal-count Z bands bound peak memory even on shapes with very uneven density.
  std::vector<std::pair<double,Mesh::Face_index>> order;order.reserve(original);
  for(auto f:mesh.faces()){double z=0;for(auto v:CGAL::vertices_around_face(mesh.halfedge(f),mesh))z+=mesh.point(v).z();order.push_back({z/3,f});}
  std::sort(order.begin(),order.end(),[](auto a,auto b){return a.first<b.first;});
  for(size_t i=0;i<order.size();i++)bins[std::min(patches-1,i*patches/order.size())].push_back(order[i].second);
  order.clear();order.shrink_to_fit();
  Mesh joined;std::unordered_map<Key,Mesh::Vertex_index,Hash> joined_vertices;
  auto original_section=[&](size_t band){
   Mesh patch;std::unordered_map<uint32_t,Mesh::Vertex_index> local;
   for(auto f:bins[band]){std::array<Mesh::Vertex_index,3> vs;int i=0;for(auto v:CGAL::vertices_around_face(mesh.halfedge(f),mesh)){auto ins=local.emplace(v.idx(),Mesh::null_vertex());if(ins.second)ins.first->second=patch.add_vertex(mesh.point(v));vs[i++]=ins.first->second;}
    if(patch.add_face(vs)==Mesh::null_face())throw std::runtime_error("Patch extraction failed");}
   return patch;
  };
  const std::string cache_root="";
  if(!cache_root.empty())std::filesystem::create_directories(cache_root);
  auto simplify_section=[&](size_t band){
   std::string cache=cache_root.empty() ? "" : cache_root+"/section-"+std::to_string(band)+".stl";
   if(!cache.empty() && std::filesystem::exists(cache)){
    try{auto saved=read_stl(cache);log("Reusing checked section "+std::to_string(band+1));return saved;}
    catch(const std::exception&){log("Ignoring unreadable section cache");}
   }
   Mesh patch=original_section(band);
   auto constrained=patch.add_property_map<Mesh::Edge_index,bool>("e:locked",false).first;for(auto e:patch.edges())constrained[e]=CGAL::is_border(e,patch);
   using Placement=SMS::Constrained_placement<FloatPlacement,decltype(constrained)>;
   {Quadric policy(patch);Filter filter;SMS::Count_stop_predicate<Mesh> stop(size_t(patch.number_of_edges()*tol));Progress visitor;
    log("Simplifying locked-boundary section "+std::to_string(band+1)+" / "+std::to_string(patches)+" ("+std::to_string(patch.number_of_faces())+" triangles)");
    SMS::edge_collapse(patch,stop,CGAL::parameters::edge_is_constrained_map(constrained).get_cost(policy.get_cost()).get_placement(Placement(constrained,FloatPlacement{&policy})).filter(filter).visitor(visitor));}
   patch.collect_garbage();
   if(!cache.empty()){
    write_stl(patch,cache);
    try{patch=read_stl(cache);}
    catch(const std::exception&){log("Keeping original section "+std::to_string(band+1)+" because simplified STL coordinates do not weld cleanly");patch=original_section(band);write_stl(patch,cache);}
   }
   return patch;
  };

  auto append_patch=[&](const Mesh& patch){
   for(auto f:patch.faces()){
    std::array<Mesh::Vertex_index,3> vs;int i=0;for(auto v:CGAL::vertices_around_face(patch.halfedge(f),patch)){auto p=patch.point(v);Key key{{float(p.x()),float(p.y()),float(p.z())}};auto ins=joined_vertices.emplace(key,Mesh::null_vertex());if(ins.second)ins.first->second=joined.add_vertex(p);vs[i++]=ins.first->second;}
    if(joined.add_face(vs)==Mesh::null_face())return false;
   }
   return true;
  };
  const size_t concurrency=4;size_t fallback_sections=0;
  for(size_t batch=0;batch<patches;batch+=concurrency){
   std::vector<std::future<Mesh>> jobs;
   for(size_t i=batch;i<std::min(patches,batch+concurrency);i++)jobs.push_back(std::async(std::launch::async,simplify_section,i));
   std::vector<Mesh> ready;for(auto& job:jobs)ready.push_back(job.get());
   Mesh saved=joined;auto saved_vertices=joined_vertices;bool good=true;
   for(const auto& patch:ready)if(!append_patch(patch)){good=false;break;}
   if(!good){
    joined=std::move(saved);joined_vertices=std::move(saved_vertices);
    log("Keeping original geometry for sections "+std::to_string(batch+1)+" to "+std::to_string(batch+ready.size())+" to preserve clean junctions");
    for(size_t i=batch;i<batch+ready.size();i++)if(!append_patch(original_section(i)))throw std::runtime_error("Original section fallback could not stitch; refusing output");
    fallback_sections+=ready.size();
   }
   log("Sections completed; accumulated output triangles "+std::to_string(joined.number_of_faces()));
  }
  log("Original-geometry fallback sections: "+std::to_string(fallback_sections));
  mesh=std::move(joined);
  mesh.collect_garbage();double simplified=seconds();log("Simplification finished: "+std::to_string(mesh.number_of_faces())+" triangles");

  Audit after=validate(mesh,false);if(before.shells!=after.shells)throw std::runtime_error("Shell connectivity or genus changed");
  write_stl(mesh,tmp);mesh.clear();log("Re-reading actual STL bytes for final validation");Mesh serialized=read_stl(tmp);Audit final=validate(serialized,false);if(before.shells!=final.shells)throw std::runtime_error("STL round-trip changed topology");
  if(serialized.number_of_faces()>=original)throw std::runtime_error("The mesh could not be reduced without breaking its seams. Use full STL.");
  std::filesystem::create_hard_link(tmp,out);std::filesystem::remove(tmp);tmp.clear();rusage usage;getrusage(RUSAGE_SELF,&usage);
  std::cout<<std::setprecision(12)<<"{\"passedExportChecks\":true,\"selfIntersectionsChecked\":false,\"algorithm\":\"CGAL Garland-Heckbert QEM\",\"originalTriangles\":"<<original<<",\"triangles\":"<<serialized.number_of_faces()<<",\"actualFraction\":"<<double(serialized.number_of_faces())/original<<",\"targetFraction\":"<<tol<<",\"seconds\":"<<seconds()<<",\"peakRSSMiB\":"<<usage.ru_maxrss/1024.<<",\"fallbackSections\":"<<fallback_sections<<"}"<<std::endl;
  return 0;
 }catch(const std::exception&e){if(!tmp.empty())std::filesystem::remove(tmp);log(std::string("REFUSED: ")+e.what());return 2;}
}
