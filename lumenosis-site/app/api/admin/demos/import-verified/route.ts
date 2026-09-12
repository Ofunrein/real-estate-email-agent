import { createHash, randomBytes, randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import type { DemoRoom } from "@/content/demo-rooms";
import { tokenHash } from "@/lib/demo-room";
import { verifyListingImages } from "@/lib/listing-image-qa";
import { sql } from "@/lib/turso";

const Facts = z.object({
  status: z.literal("active"), price: z.number().int().min(25000), beds: z.number().nonnegative(), baths: z.number().nonnegative(), squareFeet: z.number().int().positive(), acreage: z.number().nonnegative(), mls: z.string().min(1), propertyType: z.string().min(1), yearBuilt: z.number().int().min(0).max(2100), lotSquareFeet: z.number().int().nonnegative(), pricePerSquareFoot: z.number().int().nonnegative(), listedAt: z.string().min(1), summary: z.string().min(30), highlights: z.array(z.string()).min(3).max(8), buyerNotes: z.array(z.string()).max(6),
});
const Input = z.object({
  fullName:z.string().min(2), email:z.string().email(), businessName:z.string().min(2), listingAddress:z.string().min(8), listingUrl:z.string().url(), senderInbox:z.string().email().refine(v=>v.endsWith("@agentmail.to")), idempotencyKey:z.string().min(1).max(255), facts:Facts, imageUrls:z.array(z.string().url()).length(3),
});
const allowedPhoto=(url:string)=>{ try { const parsed=new URL(url); return parsed.protocol==="https:" && new Set(["ap.rdcpix.com","ssl.cdn-redfin.com"]).has(parsed.hostname); } catch { return false; } };
const slugify=(v:string)=>v.toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/(^-|-$)/g,"").slice(0,60);

export async function POST(request:Request){
  const configured=process.env.LUMENOSIS_DEMO_AUTOMATION_TOKEN??"";
  const supplied=request.headers.get("authorization")?.replace(/^Bearer\s+/i,"")??"";
  if(!configured||supplied!==configured) return NextResponse.json({error:"Unauthorized"},{status:401});
  const parsed=Input.safeParse(await request.json());
  if(!parsed.success) return NextResponse.json({error:"Invalid verified listing",fields:parsed.error.issues.map(i=>i.path.join("."))},{status:400});
  const input=parsed.data;
  const supportedListing = input.listingUrl.includes("realtor.com/realestateandhomes-detail/") || input.listingUrl.includes("redfin.com/");
  if(!supportedListing||!input.imageUrls.every(allowedPhoto)) return NextResponse.json({error:"Unsupported provenance"},{status:422});
  const id=`agentmail-${createHash("sha256").update(input.idempotencyKey).digest("hex")}`;
  const existing=await sql("SELECT access_token FROM demo_rooms WHERE id = ? LIMIT 1",[id]);
  if(existing[0]) return NextResponse.json({id,demoUrl:`https://lumenosis.com/demo/${String(existing[0].access_token)}`,reused:true});
  const openaiKey=process.env.OPENAI_API_KEY;
  if(!openaiKey) return NextResponse.json({error:"Image QA is not configured"},{status:503});
  const imageQa=await verifyListingImages(input.listingAddress,input.listingUrl,input.imageUrls,openaiKey);
  if(!imageQa.passed) return NextResponse.json({error:"Listing images failed QA",images:imageQa.assessments.map(({url,reason})=>({url,reason}))},{status:422});
  const now=new Date(); const expiresAt=new Date(now.getTime()+14*86400000).toISOString();
  const token=randomBytes(32).toString("base64url"); const prospectId=randomUUID(); const listingId=randomUUID();
  const firstName=input.fullName.split(/\s+/)[0]; const slug=`${slugify(input.fullName)}-${slugify(input.listingAddress)}-${id.slice(0,8)}`;
  const room:DemoRoom={slug,prospect:{firstName,fullName:input.fullName,businessName:input.businessName,role:"REALTOR®"},listing:{address:input.listingAddress,...input.facts,images:input.imageUrls.map((src,index)=>({src,alt:`${input.listingAddress} listing photo ${index+1}`}))},sources:[{label:"Primary active listing",url:input.listingUrl,checkedAt:now.toISOString().slice(0,10)}],qa:{passed:true,checkedAt:now.toISOString(),images:"exact-listing-property-photos",responsiveViewports:[320,390,768,1024,1440]},expiresAt,approved:true};
  await sql("INSERT INTO prospects (id, full_name, first_name, email, business_name, sender_inbox) VALUES (?, ?, ?, ?, ?, ?)",[prospectId,input.fullName,firstName,input.email,input.businessName,input.senderInbox]);
  await sql("INSERT INTO listings (id, prospect_id, address, source_url, status, price, beds, baths, square_feet, acreage, mls, details_json, sources_json, verified_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",[listingId,prospectId,input.listingAddress,input.listingUrl,input.facts.status,input.facts.price,input.facts.beds,input.facts.baths,input.facts.squareFeet,input.facts.acreage,input.facts.mls,JSON.stringify(input.facts),JSON.stringify(room.sources),now.toISOString()]);
  await sql("INSERT INTO demo_rooms (id, prospect_id, listing_id, slug, token_hash, access_token, config_json, status, expires_at, approved_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'approved', ?, ?)",[id,prospectId,listingId,slug,tokenHash(token),token,JSON.stringify(room),expiresAt,now.toISOString()]);
  return NextResponse.json({id,demoUrl:`https://lumenosis.com/demo/${token}`,approved:true,reused:false});
}
