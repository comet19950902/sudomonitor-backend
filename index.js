import express from 'express';
import path from "path";
import { fileURLToPath } from "url";
import cors from 'cors';
import axios from 'axios';
import dayjs from 'dayjs';
import puppeteer from 'puppeteer';
import { Alchemy, Network } from "alchemy-sdk";

////////////////////////////////////////////////////////////
//						sart server						  //
////////////////////////////////////////////////////////////
const app = express();
app.use(cors());
const PORT = process.env.PORT || 8000;

const __filename = fileURLToPath( import.meta.url );

const __dirname = path.dirname( __filename );

app.use( express.static( __dirname + "/build" ) );

app.get("", (req, res) => {
	res.sendFile(__dirname + "/build/index.html");
});

// start the server
app.listen(PORT, () => {
	console.log(`Server listening on port ${PORT}`);
});

//////////////////////////////////////////////////////////////
//					Start Project							//
//////////////////////////////////////////////////////////////
// collection address
const address = "0x5Af0D9827E0c53E4799BB226655A1de152A425a5";
	
// configure for alchemy
const config = {
	apiKey: "BulCaczA8_MGcz34wlxGZNPVslXQOgRi",
	network: Network.ETH_MAINNET,
};
const alchemy = new Alchemy(config);

// parse url for airtable
const url = ( param ) => {
	return `https://api.airtable.com/v0/appn1gRuLtx22e5p6/${param}`;
}

const Headers = {
	headers: {
		"Content-Type": "application/json",
		"accept": "application/json",
		"Access-Control-Allow-Origin": "*",
		"Authorization": `Bearer key2OfbPofuEs2Uwj`,
	},
}

const query = ( key_, val_) => {
	return{
		filterByFormula: `${key_}='${val_}'`
	}
};

/*************************************************************************************
|| 									ALCHEMY API 									||
*************************************************************************************/
// get nfts from alchemy
const getNFTs = async ( pageKey_ ) => {
	const opts = {
		pageKey: pageKey_,
		omitMetadata: false,
		//pageSize: 100, => default
	};

	const fetchedNFTs  = await alchemy.nft.getNftsForContract(address, opts);

	return fetchedNFTs.nfts;
};

/*************************************************************************************
|| 									SCRAPING BOT 									||
*************************************************************************************/
// scraping data from sudoswap
const scrapingBot = async () => {
	try {
		// get Value of Item
		const getText = async (dom) => {
			const result = await page.evaluate((dom) => {
				if( dom === '.text-truncate' ) {
					return Array.from(document.querySelectorAll(dom), (el) => el.innerHTML.slice(2).trim());
				}else{
					return Array.from(document.querySelectorAll(dom), (el) => el.innerHTML.trim());
				}
			}, dom );
			  
			return result;
		}

		// get src of img tag
		const getUrl = async (dom) => {
			const result = await page.evaluate((dom) => {
				return Array.from(document.querySelectorAll(dom), (el) => el.src);
			}, dom );
			  
			return result;
		}

		const browser = await puppeteer.launch({headless: true});
		const page = await browser.newPage();
	
		await page.goto( `https://sudoswap.xyz/#/browse/buy/${ address }`, {timeout: 4000000});
		
		await page.waitForTimeout(10000).then(() => console.log('Waited a second!'));
		await page.screenshot({path: 'screenshot.png'});
		
		const statValues = await page.evaluate(()=>{
			const spanTags = document.querySelectorAll('.statValue span');
			return [...spanTags].map(span => span.innerHTML.trim());
		});

		const listings = await page.$eval('.listingTokenPillBadge', element => element.innerHTML.trim());
		const colName = await getText('.nftName');
		const colIcon = await getUrl('.nftIcon');

		// collection info
		const collection = {
			address: address,
			logoUrl: colIcon[0].split("?")[0],
			name: colName[0],
			symbol: '',
			listings: listings,
			floorPrice: statValues[0],
			bestOffer: statValues[1],
			offerTVL: statValues[2],
			volumn: statValues[3]
		}
		
		// click the "Load More" button until it disapears.
		let loadMore = true;
		while ( loadMore ) {
			try {
				await page.click('.loadMoreBtn');
				await page.waitForTimeout(3000)
					.then(()=> console.log('button clicked') );
			} catch {
				loadMore = false;
			}
		}

		const imageUrls = await getUrl('.nftCardImage');
		const tokenIds = await getText('.text-truncate');
		const nftNames = await getText('.nameWrapper');
		const nftPrices = await getText('.priceContainer div');
		const lastDate = dayjs().format('YYYY-MM-DD');

		// nfts info listed.
		const nfts = tokenIds.map((tokenId, index) => {
			return {
				address: address,
				tokenId: tokenId,
				name: nftNames[index],
				price: nftPrices[index],
				lastDate: lastDate,
				imageUrl: imageUrls[index].split("?")[0],
			};
		});

		await browser.close();

		return{
			collection: collection,
			nfts: nfts
		}
	} catch (error) {
		console.error(error);
	}
}

// get scraping data
app.get('/scraping', async (req, res) => {
	const {collection, nfts } = await scrapingBot();

	// Remove all records that match the given condition
	const collectionRecords = await getAllRecords('collectionTB');
	for (let i = 0; i < collectionRecords.length; i++) {
		if (collectionRecords[i].fields.address === address) {
			await deleteRecord('collectionTB', collectionRecords[i].id);
		}
	}

	// Remove all records that match the given condition
	const nftRecords = await getAllRecords('nftTB');
	for (let i = 0; i < nftRecords.length; i++) {
		if (nftRecords[i].fields.address === address) {
			await deleteRecord('collectionTB', nftRecords[i].id);
		}
	}
	
	await createRecord( "collectionTB", collection );	
	nfts.map( async(nft) => (
		await createRecord( "nftTB", nft )
    ));
	
	res.status(200).json({ status: "success", data: { collection, nfts} });
});

/*************************************************************************************
|| 									FRONTEND API 									||
*************************************************************************************/
// get collection : from airtable
app.get('/getCollections', async (req, res) => {
	const data = await getAllRecords( 'collectionTB' );
	res.status(200).json({ status: "success", data: data });
});

// get all NFTs : from airtable
app.get('/getNFTs/view', async (req, res) => {	
	const data = await getAllRecords( 'nftTB' );
	res.status(200).json({ status: "success", data: data });
});

// get NFTs of given collection : from airtable
app.get('/getNFTs', async (req, res) => {
	try {
		const occurValue = req.query.occur || 'default_value';
		const data = await getRecords( 'nftTB', query( 'address', occurValue ) );
			
		res.status(200).json({ status: "success", data: data });
	} catch (error) {
		console.error(error);
		res.status(500).send('Error retrieving data from Airtable.');
	}
});

/*************************************************************************************
|| 									AIRTABLE CRUD api								||
*************************************************************************************/
// Get all records from a table
const getAllRecords = async (tableName) => {
    try {
		const response = await axios.get(
			url( tableName ),
			Headers
		);
        return response.data.records;
    } catch (error) {
        console.error(error);
    }
}

// Get records with condition from a table
const getRecords = async( tableName, query ) => {
	try{
		const response = await axios.get(
			url( tableName ),
			{
				headers: Headers.headers,
				params: query
			}
		);

		return response.data.records;
	}catch(error){
		console.error(error);
	}
}

// Create a new record in a table
const createRecord = async (tableName, data_) => {
	try {
        const response = await axios.post(
			url(tableName), 
			{
				fields: data_
			},
			{
				headers: Headers.headers,
			},			
		);

		return response.data;
    } catch (error) {
        console.error(error);
    }
}


// Update an existing record in a table
const updateRecord = async (tableName, recordID, data) => {
    try {
        const response = await axios.put( url(tableName) + '/' + recordID, { fields: data}, { Headers });
        return response.data;
    } catch (error) {
        console.error(error);
    }
}

// Delete an existing record from a table
const deleteRecord = async (tableName, recordID) => {
    try {
        const response = await axios.delete(
			url( `${tableName}/${recordID}` ),
			Headers
		);
        return response.data;
    } catch (error) {
        console.error(error);
    }
}