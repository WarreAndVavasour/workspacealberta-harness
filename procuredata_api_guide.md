# ProcureData API Guide for CanadaBuys Access

ProcureData provides normalized access to Canadian government procurement data through a REST API. This is the recommended replacement for direct CanadaBuys access.

## Key Features
- **Coverage**: Federal (CanadaBuys), Quebec (SEAO), all provinces, major municipalities
- **Records**: 2.6M+ procurement records, updated daily
- **Access**: REST API via RapidAPI platform
- **Free tier**: Available for development

## Authentication
1. Visit [RapidAPI](https://rapidapi.com/bureaucrat-bureaucrat-default/api/procuredata-canadian-government-procurement-api)
2. Subscribe to get your API key
3. Use `x-rapidapi-key` header in requests

## API Endpoints
- `GET /tender` - Search tenders and RFPs
- `GET /contract` - Search awarded contracts
- `GET /award` - Search contract awards
- `GET /pre_solicitation` - Early-stage notices (ACANs, RFIs)

## Search Parameters
- `q` - Full-text search (business names, keywords)
- `department` - Filter by department
- `municipality` - Filter by city (e.g., 'toronto', 'calgary')
- `category` - Procurement category (CNST, GD, SRV)
- `status` - Filter by status (Active, Open, Cancelled)
- `value_min/value_max` - Value range filtering
- `closing_after/closing_before` - Date range filtering

## Example Request
```bash
curl -X GET "https://procuredata-canadian-government-procurement-api.p.rapidapi.com/tender" \
  -H "x-rapidapi-host: procuredata-canadian-government-procurement-api.p.rapidapi.com" \
  -H "x-rapidapi-key: YOUR_API_KEY" \
  -G -d 'q=Lethbridge&department=Infrastructure'
```

## Data Fields
- `record_id` - Unique identifier
- `title_en`/`title_fr` - Tender title
- `publication_date` - Posted date
- `closing_date` - Deadline
- `buyer_id` - Organization name
- `procurement_category` - Category (Construction, Services, Goods)
- `status` - Current status

## Integration with Workspace Alberta
We can create a Cordis Plugin to automatically fetch ProcureData results and format them for our needs. This would provide:
- Daily automated searches
- Alert notifications for new opportunities
- Integration with existing contract analysis workflow
- No manual API key management needed

ProcureData is the official, supported way to access Canadian government procurement data programmatically.