// Тестбенч урока 5: держим S1 один тик и смотрим, как единица идёт по цепочке.
`timescale 1ns / 100ps

module tb_top;
    reg        clk = 1'b0;
    reg        btn = 1'b0;            // «кнопка» в руках тестбенча
    wire [2:0] led;

    always #18.5 clk = ~clk;          // период 37 нс, как 27 МГц

    // CLK_HZ = 4: LAST = 4 / 2 - 1 = 1, тик каждые 2 такта.
    top #(.CLK_HZ(4)) dut (.clk(clk), .btn_s1(btn), .led(led));

    wire [2:0] q = ~led;              // q[0] = q1, q[1] = q2, q[2] = q3 (1 = горит)
    reg  [2:0] expected [1:5];        // ожидаемая цепочка после тиков 1..5
    integer    n, errors = 0;

    initial begin
        expected[1] = 3'b001;         // q1 взял кнопку
        expected[2] = 3'b010;         // единица перешла в q2
        expected[3] = 3'b100;         // ...потом в q3
        expected[4] = 3'b000;         // ...и ушла из цепочки
        expected[5] = 3'b000;

        $dumpfile("tb_top.vcd");
        $dumpvars(0, tb_top);
        $display("тик  q1 q2 q3   ожидали");

        btn = 1'b1;                           // нажали кнопку
        for (n = 1; n <= 5; n = n + 1) begin
            repeat (2) @(posedge clk);        // один тик = 2 такта
            @(negedge clk);                   // полтакта спустя всё устоялось
            btn = 1'b0;                       // после первого тика отпускаем
            $display(" %0d    %b  %b  %b    %b  %b  %b", n, q[0], q[1], q[2],
                     expected[n][0], expected[n][1], expected[n][2]);
            if (q !== expected[n]) errors = errors + 1;
        end

        if (errors == 0) $display("ТЕСТ ПРОЙДЕН");
        else             $display("ТЕСТ НЕ ПРОЙДЕН: ошибок %0d", errors);
        $finish;
    end
endmodule
