ALTER PROCEDURE [dbo].[p_Rpt_QuoTourCardFormat]
@i_Quotations_id	INT,
@i_Option			INT
AS

  DECLARE @x_QuoListOfServices_id	INT
  DECLARE @x_DayNo					INT
  DECLARE @x_SubCardNo				INT
  DECLARE @x_QuoLines_id			INT
  DECLARE @x_TrsType				INT
  DECLARE @x_Title					VARCHAR(100)
  DECLARE @x_Service				VARCHAR(200)
  DECLARE @x_QuoCards_id			INT
  DECLARE @x_LastCity				VARCHAR(50)
  DECLARE @x_Cities_id				INT
  DECLARE @x_HotelAddressbook_id	INT
  DECLARE @x_ImageHint				VARCHAR(250)

  DECLARE @x_PrevCardNo				INT
  DECLARE @x_PrevDate					SMALLDATETIME
  DECLARE @x_NextCardNo				INT
  DECLARE @x_GapSize					INT
  DECLARE @x_FirstMissingDate			SMALLDATETIME
  DECLARE @x_LastMissingDate			SMALLDATETIME

  CREATE TABLE #QuoCards (
	QuoCards_id				INT		PRIMARY KEY IDENTITY,
	CardNo					INT,
	SubCardNo				INT,
	ServiceDate				SMALLDATETIME,
	AtTime					VARCHAR(5),
	Title					VARCHAR(100),
	ServiceDesc				VARCHAR(5000),
	Organisation			VARCHAR(200),
	HotelAddress			VARCHAR(200),
	Contact					VARCHAR(100),
	Phone					VARCHAR(100),
	QuoDetails_id			INT,
	QuoLines_id				INT,
	Cities_id				INT,
	HotelAddressbook_id		INT,
	ImageHint				VARCHAR(250),
	TrsType					INT
  )

  DELETE FROM QuoListOfServices WHERE CONVERT(SMALLDATETIME, ServiceDate, 103) < DATEADD(DAY, -30, CAST(GETDATE() AS DATE));
  DELETE FROM QuoListOfServices WHERE Quotations_id = @i_Quotations_id

--SELECT * FROM QuoListOfServices WHERE Quotations_id = 9312

  INSERT INTO QuoListOfServices exec p_Rpt_QuoTourHotelAgentList @i_Quotations_id, 1

  /*=== Set up the Car Agents ===*/
  DECLARE #QLOS CURSOR FOR
    SELECT QuoListOfServices_id, DayNo, QuoLines_id FROM QuoListOfServices
     WHERE Quotations_id = @i_Quotations_id
	 ORDER BY DayNo, AtTime

  OPEN #QLOS

  FETCH NEXT FROM #QLOS INTO @x_QuoListOfServices_id, @x_DayNo, @x_QuoLines_id

  /*=== For each day record ===*/
  WHILE @@FETCH_STATUS = 0
    BEGIN

		SELECT @x_SubCardNo = COUNT(*)+1 FROM #QuoCards WHERE CardNo = @x_DayNo

		SELECT @x_Title = dbo.[f_GetCardTitle](@x_QuoLines_id, @x_DayNo, @x_SubCardNo)
		SELECT @x_Service = dbo.[f_GetCardServiceDesc](@x_QuoLines_id, @x_DayNo, @x_SubCardNo)

		SELECT @x_HotelAddressbook_id = null

		SELECT @x_Cities_id = ql.Cities_id, @x_HotelAddressbook_id = qa.HotelAddressbook_id, @x_TrsType = ql.TrsType,
		       @x_ImageHint = CONCAT(c.City, ' ',
		           (SELECT TOP 1 Organisation FROM addressbook a WHERE a.addressbook_id = qa.HotelAddressbook_id))
		  FROM QuoLines ql
		       LEFT JOIN QuoAccommodation qa ON ql.QuoAccommodation_id = qa.QuoAccommodation_id
		       LEFT JOIN Cities c ON ql.Cities_id = c.cities_id
		 WHERE QuoLines_id = @x_QuoLines_id

		 -- if city repeated, enter as null
		 IF EXISTS (SELECT * FROM #QuoCards WHERE Cities_id = @x_Cities_id)
		   SELECT @x_Cities_id = null

		 -- if hotel repeated, enter as null
		 IF EXISTS (SELECT * FROM #QuoCards WHERE HotelAddressbook_id = @x_HotelAddressbook_id)
		   SELECT @x_HotelAddressbook_id = null

		INSERT INTO #QuoCards(CardNo, SubCardNo, ServiceDate, AtTime, Organisation, ServiceDesc,
					HotelAddress, Contact, Phone, Title, QuoDetails_id, QuoLines_id,
					Cities_id, HotelAddressbook_id, ImageHint, TrsType)
		  SELECT TOP 1 DayNo, @x_SubCardNo, CONVERT(SMALLDATETIME, ServiceDate, 103), AtTime, Organisation, @x_Service,
					 HotelAddress, Contact, Phone, @x_Title, QuoDetails_id, QuoLines_id,
					 @x_Cities_id, @x_HotelAddressbook_id, @x_ImageHint, @x_TrsType
			FROM QuoListOfServices
		   WHERE QuoListOfServices_id = @x_QuoListOfServices_id

		FETCH NEXT FROM #QLOS INTO @x_QuoListOfServices_id, @x_DayNo, @x_QuoLines_id

	END

  CLOSE #QLOS
  DEALLOCATE #QLOS

  /*=== Fill gaps between existing CardNo's with "Day(s) At Leisure" filler rows.
        Gaps are found on DISTINCT CardNo (grouped first so multiple SubCardNo rows
        on the same day don't register as consecutive/adjacent days). A gap of exactly
        one missing day gets a single "Day At Leisure" row on that day; a gap of more
        than one missing day gets a single "Days At Leisure" row on the first missing
        day, describing the full range. ===*/
  DECLARE #GAPS CURSOR FOR
    WITH DistinctCards AS (
	  SELECT CardNo, MIN(ServiceDate) AS ServiceDate
	    FROM #QuoCards
	   GROUP BY CardNo
	),
	Ordered AS (
	  SELECT CardNo, ServiceDate,
	         LEAD(CardNo) OVER (ORDER BY CardNo) AS NextCardNo
	    FROM DistinctCards
	)
	SELECT CardNo, ServiceDate, NextCardNo
	  FROM Ordered
	 WHERE NextCardNo - CardNo > 1

  OPEN #GAPS

  FETCH NEXT FROM #GAPS INTO @x_PrevCardNo, @x_PrevDate, @x_NextCardNo

  WHILE @@FETCH_STATUS = 0
    BEGIN

		SELECT @x_GapSize = @x_NextCardNo - @x_PrevCardNo - 1
		SELECT @x_FirstMissingDate = DATEADD(DAY, 1, @x_PrevDate)
		SELECT @x_LastMissingDate = DATEADD(DAY, @x_GapSize, @x_PrevDate)

		IF @x_GapSize = 1
		  BEGIN
		    INSERT INTO #QuoCards (CardNo, SubCardNo, ServiceDate, AtTime, Title, ServiceDesc)
		    VALUES (@x_PrevCardNo + 1, 1, @x_FirstMissingDate, '09:00', 'Day At Leisure', 'Day At Leisure')
		  END
		ELSE
		  BEGIN
		    INSERT INTO #QuoCards (CardNo, SubCardNo, ServiceDate, AtTime, Title, ServiceDesc)
		    VALUES (@x_PrevCardNo + 1, 1, @x_FirstMissingDate, '09:00', 'Days At Leisure',
				  'Day At Leisures  from ' + CONVERT(VARCHAR(10), @x_FirstMissingDate, 103) +
				  ' to ' + CONVERT(VARCHAR(10), @x_LastMissingDate, 103))
		  END

		FETCH NEXT FROM #GAPS INTO @x_PrevCardNo, @x_PrevDate, @x_NextCardNo

	END

  CLOSE #GAPS
  DEALLOCATE #GAPS

  SELECT TOP 1 @x_QuoCards_id = QuoCards_id FROM #QuoCards ORDER BY CardNo DESC, SubCardNo DESC
  IF EXISTS (SELECT * FROM #QuoCards WHERE QuoCards_id = @x_QuoCards_id AND ServiceDesc LIKE 'Departure%')
    BEGIN
	  SELECT @x_LastCity = c.City
	    FROM #QuoCards qc
	         LEFT JOIN QuoLines ql ON qc.QuoLines_id = ql.QuoLines_id
			 LEFT JOIN QuoServices qs ON ql.Services_id = qs.Services_id
			 LEFT JOIN Services s ON qs.Services_id = s.services_id
			 LEFT JOIN Cities c ON s.cities_id = c.cities_id
	   WHERE qc.QuoCards_id = @x_QuoCards_id
	  IF LTRIM(RTRIM(COALESCE(@x_LastCity,''))) > ''
	    BEGIN
		 UPDATE #QuoCards SET Title = 'Depart from ' +  @x_LastCity WHERE QuoCards_id = @x_QuoCards_id
		END
	END

  SELECT * FROM #QuoCards ORDER BY CardNo, SubCardNo
